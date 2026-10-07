/**
 * DKC-054 — den signerede installationsplan.
 *
 * Planen er deterministisk: samme katalog, profil, konfiguration og scopet
 * giver byte-for-byte samme trin og samme digest. Signaturen (HMAC-SHA256)
 * dækker hele det kanoniske indhold undtagen signaturfeltet. En plan uden
 * gyldig signatur må ikke eksekveres, og agenter kan ikke ændre broker, policy,
 * pakkekilde eller payload — de felter indgår i digesten.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { buildDiagnostics } from "./diagnostics.mjs";

export const PLAN_API_VERSION = "contracts.platform/v1alpha1";
export const PLAN_KIND = "InstallerPlan";

export function canonicalPlan(plan) {
  const { signature, ...rest } = plan ?? {};
  return JSON.parse(JSON.stringify(rest));
}

export function planDigest(plan) {
  return createHash("sha256").update(stableStringify(canonicalPlan(plan))).digest("hex");
}

function idempotencyKey(installationId, stepId) {
  return createHash("sha256").update(`${installationId}:${stepId}`).digest("hex");
}

export function signPlan(plan, { keyId, secret, signedAt = new Date().toISOString() } = {}) {
  if (!keyId) throw new Error("signPlan kræver keyId");
  if (!secret) throw new Error("signPlan kræver en signeringsnøgle (secret)");
  const value = createHmac("sha256", secret).update(stableStringify(canonicalPlan(plan))).digest("hex");
  return { ...canonicalPlan(plan), signature: { algorithm: "hmac-sha256", keyId, value, signedAt } };
}

function lookupKey(keyring, keyId) {
  if (!keyring || !keyId) return null;
  if (Array.isArray(keyring.keys)) return keyring.keys.find((k) => k.keyId === keyId) ?? null;
  return keyring[keyId] ? { keyId, secret: keyring[keyId] } : null;
}

export function verifyPlanSignature(plan, keyring) {
  const signature = plan?.signature;
  if (!signature) return { ok: false, reason: "planen er ikke signeret" };
  if (signature.algorithm !== "hmac-sha256") return { ok: false, reason: `ukendt signaturalgoritme '${signature.algorithm}'` };
  const entry = lookupKey(keyring, signature.keyId);
  if (!entry) return { ok: false, reason: `signeringsnøglen '${signature.keyId}' er ikke kendt` };
  if (entry.revokedAt) return { ok: false, reason: `signeringsnøglen '${signature.keyId}' er tilbagekaldt` };
  const expected = createHmac("sha256", entry.secret).update(stableStringify(canonicalPlan(plan))).digest("hex");
  const a = Buffer.from(String(signature.value), "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "planens signatur matcher ikke indholdet" };
  return { ok: true, keyId: signature.keyId, digest: planDigest(plan) };
}

const STEP_FOR_KIND = {
  "security-core": "provision",
  application: "provision",
  technical: "provision",
  "data-service": "provision",
  "host-management": "provision",
  integration: "provision",
};

/**
 * Byg en installationsplan fra et DKC-053-preview og et host-scope.
 * Kun trin, der følger af den valgte closure og konfigurationen, medtages.
 */
export function buildInstallerPlan({
  installationId,
  profile,
  platformId,
  hostScope,
  configDigest,
  preview,
  preflight,
  components = null,
  now = new Date().toISOString(),
} = {}) {
  const steps = [];
  let order = 1;
  const add = (id, kind, description, mutating, requiresApproval, dependsOn = []) => {
    if (steps.some((s) => s.id === id)) return;
    steps.push({
      id,
      order: order++,
      kind,
      description,
      idempotencyKey: idempotencyKey(installationId, id),
      mutating,
      requiresApproval,
      dependsOn,
      state: "pending",
    });
  };

  add("preflight", "preflight", "Kør preflight på værts-OS, disk, database og scope", false, false);
  const closure = preview?.result?.closure ?? [];
  const componentIndex = components instanceof Map ? components : new Map((components ?? []).map((c) => [c.metadata?.name, c]));
  for (const componentId of closure) {
    const component = componentIndex.get(componentId) ?? null;
    const kind = STEP_FOR_KIND[component?.componentType] ?? "provision";
    add(`provision-${componentId}`, kind, `Klargør komponenten '${componentId}'`, true, true, ["preflight"]);
  }
  add("migrate-schema", "migrate", "Anvend versionerede databaseskema-migrationer (uden overtagelse)", true, true, steps.filter((s) => s.kind === "provision").map((s) => s.id));
  add("configure", "configure", "Anvend den ene ønskede konfiguration pr. installation/tenant/modul", true, true, ["migrate-schema"]);
  add("verify", "verify", "Verificér faktisk tilstand mod ønsket tilstand", false, false, ["configure"]);

  const diagnostics = buildDiagnostics({
    artifactRef: `diagnostics://installer/${installationId}/${planDigest({ steps })}`,
    payload: { installationId, profileRef: profile?.metadata?.name ?? profile, platformId, hostScopeRef: hostScope?.metadata?.name, steps: steps.map((s) => ({ id: s.id, state: s.state })) },
  });

  return {
    apiVersion: PLAN_API_VERSION,
    kind: PLAN_KIND,
    metadata: {
      name: `install-plan-${installationId}`.slice(0, 63),
      version: "1.0.0",
      createdAt: now,
      description: "Signeret, deterministisk installationsplan med resumable trin og preflight.",
    },
    installationId,
    profileRef: profile?.metadata?.name ?? profile,
    platformId,
    hostScopeRef: hostScope?.metadata?.name ?? "unknown-host-scope",
    configDigest,
    preflight,
    steps,
    resume: { stateRef: `configuration/installer-state-${installationId}.json`, lastCompletedStep: null, resumable: true },
    diagnostics: { redacted: diagnostics.redacted, secretScan: diagnostics.secretScan, artifactRef: diagnostics.artifactRef },
    restrictions: { formatDisks: false, adoptExistingSchema: false, changeHostOs: false },
  };
}

/** Semantiske planproblemer ud over skemaet. */
export function installerPlanProblems(plan, { now = Date.now() } = {}) {
  const problems = [];
  const at = (path, message) => problems.push({ path, message });

  if (plan?.restrictions?.formatDisks !== false) at("/restrictions/formatDisks", "installatøren må ikke formatere diske");
  if (plan?.restrictions?.adoptExistingSchema !== false) at("/restrictions/adoptExistingSchema", "installatøren må ikke overtage et eksisterende databaseskema");
  if (plan?.restrictions?.changeHostOs !== false) at("/restrictions/changeHostOs", "installatøren må ikke ændre host-OS uden konkret scope");
  if (plan?.preflight?.ok === false && (plan?.preflight?.blockingProblems ?? []).length === 0) at("/preflight/blockingProblems", "en fejlende preflight skal angive de blokerende problemer");
  if (plan?.diagnostics?.secretScan !== "pass") at("/diagnostics/secretScan", "diagnostikken må ikke indeholde hemmeligheder");
  if (plan?.diagnostics?.redacted !== true) at("/diagnostics/redacted", "diagnostikken skal være redigeret");

  const ids = new Set();
  const order = new Map((plan?.steps ?? []).map((s) => [s.id, s.order]));
  for (const [i, step] of (plan?.steps ?? []).entries()) {
    if (ids.has(step.id)) at(`/steps/${i}/id`, `dubleret trin-id '${step.id}'`);
    ids.add(step.id);
    for (const dep of step.dependsOn ?? []) {
      if (!order.has(dep)) at(`/steps/${i}/dependsOn`, `trinnet afhænger af det ukendte trin '${dep}'`);
      else if (order.get(dep) >= step.order) at(`/steps/${i}/dependsOn`, `trinnet afhænger af '${dep}', som ikke kommer før det`);
    }
    if (step.mutating === true && step.requiresApproval !== true) at(`/steps/${i}/requiresApproval`, "et muterende trin skal kræve menneskelig godkendelse");
  }
  const orders = (plan?.steps ?? []).map((s) => s.order).sort((a, b) => a - b);
  for (let i = 1; i < orders.length; i += 1) {
    if (orders[i] === orders[i - 1]) at("/steps", `trinrækkefølgen indeholder dubletter (${orders[i]})`);
  }
  if (plan?.metadata?.createdAt && Date.parse(plan.metadata.createdAt) > now + 60000) at("/metadata/createdAt", "planen er dateret i fremtiden");
  return problems;
}
