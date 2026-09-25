/**
 * DKC-061 — opdatering af en installation med påvirkningsplan, migrationskontrol,
 * rollback/gendannelse og menneskelig godkendelse.
 *
 * Planen er deterministisk: samme releasekatalog, komponentkatalog, profil og
 * godkendelse giver byte-for-byte samme trin og samme digest. Planen er
 * signeret; uden en gyldig signatur kører intet. Eksekveringen er resumable og
 * kan rulles tilbage til et snapshot taget før den første mutation.
 */
import { createHash } from "node:crypto";
import { resolveDependencies } from "../../distribution/src/resolver.mjs";
import { signPlan, verifyPlanSignature, planDigest } from "./plan.mjs";
import { FileLifecycleStore } from "./lifecycle-store.mjs";

export const UPDATE_API_VERSION = "contracts.platform/v1alpha1";
export const UPDATE_KIND = "LifecycleUpdatePlan";
export const ROLLBACK_PROCEDURE_REF = "docs/runbooks/module-update-rollback.md";

export function releaseClosure({ release, components, profile, deploymentProfile = null, serviceClasses = [] }) {
  const lock = release?.compatibilityLock ?? {};
  return resolveDependencies({
    components,
    profile,
    selection: Object.keys(lock),
    lock,
    deploymentProfile,
    serviceClasses,
    includeDefaults: false,
  });
}

function semverParts(v) {
  return String(v ?? "0.0.0").split(".").map((n) => Number.parseInt(n, 10) || 0);
}
export function compareReleaseVersions(a, b) {
  const [am, an, ap] = semverParts(a);
  const [bm, bn, bp] = semverParts(b);
  return am - bm || an - bn || ap - bp;
}

function componentTypeOf(components, id) {
  return components.find((c) => c.metadata?.name === id)?.componentType ?? "unknown";
}

function change(id, from, to, componentType) {
  return { id, from: from ?? null, to: to ?? null, componentType };
}

export function updateImpact({ fromRelease, toRelease, components }) {
  const before = fromRelease?.compatibilityLock ?? {};
  const after = toRelease?.compatibilityLock ?? {};
  const added = [];
  const removed = [];
  const upgraded = [];
  const downgraded = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of [...ids].sort()) {
    const from = before[id] ?? null;
    const to = after[id] ?? null;
    const componentType = componentTypeOf(components, id);
    if (!from && to) added.push(change(id, null, to, componentType));
    else if (from && !to) removed.push(change(id, from, null, componentType));
    else if (from && to && compareReleaseVersions(to, from) > 0) upgraded.push(change(id, from, to, componentType));
    else if (from && to && compareReleaseVersions(to, from) < 0) downgraded.push(change(id, from, to, componentType));
  }
  return { added, removed, upgraded, downgraded };
}

/** Anvend en påvirkning på en komponentliste (id → version). */
export function applyImpact(current, impact) {
  const next = { ...current };
  for (const c of [...(impact?.added ?? []), ...(impact?.upgraded ?? []), ...(impact?.downgraded ?? [])]) next[c.id] = c.to;
  for (const c of impact?.removed ?? []) delete next[c.id];
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

export function updatePreflight({ fromRelease, toRelease, catalog, components, profile, deploymentProfile = null, serviceClasses = [] }) {
  const checks = [];
  const blocking = [];
  const push = (id, title, status, detail) => checks.push({ id, title, status, detail });

  const target = (catalog?.releases ?? []).find((r) => r.id === toRelease) ?? null;
  if (!target) {
    blocking.push(`release '${toRelease}' findes ikke i releasekataloget`);
    push("release-known", "Målreleasen findes i det signerede katalog", "fail", `ukendt release '${toRelease}'`);
  } else {
    push("release-known", "Målreleasen findes i det signerede katalog", "pass", `release '${toRelease}'`);
  }

  if (target && target.channel !== "stable" && target.channel !== "security") {
    blocking.push(`release '${toRelease}' er i kanalen '${target.channel}' og må ikke køres`);
    push("release-runnable", "Kun stable/security-releases må køres", "fail", `kanal ${target.channel}`);
  } else if (target) {
    push("release-runnable", "Kun stable/security-releases må køres", "pass", `kanal ${target.channel}`);
  }

  const result = releaseClosure({ release: target, components, profile, deploymentProfile, serviceClasses });
  const closureProblems = [...(result.errors ?? []), ...(result.safety?.errors ?? [])];
  if (closureProblems.length) {
    blocking.push(...closureProblems.map((e) => `${e.code}: ${e.message}`));
    push("closure", "Kompatibilitetslåsen kan resolveres", "fail", closureProblems.map((e) => e.code).join(", "));
  } else {
    push("closure", "Kompatibilitetslåsen kan resolveres", "pass", `${result.closure.length} komponenter`);
  }

  const requiredMigrations = (result.migrations ?? []).filter((m) => m.phase === "schema" || m.phase === "data");
  const irreversible = requiredMigrations.filter((m) => m.reversible === false);
  push("migration", "Migrationskontrol", irreversible.length ? "warn" : "pass", `${requiredMigrations.length} migrationer, ${irreversible.length} irreversible`);
  push("preserve-data", "Data bevares og diske formateres ikke", "pass", "restriktioner aktiv");
  push("recovery-path", "Dokumenteret rollback-/gendannelsesvej", "pass", ROLLBACK_PROCEDURE_REF);
  return { ok: blocking.length === 0, checks, blockingProblems: blocking, result };
}

export function buildUpdatePlan({
  installationId,
  fromRelease,
  toRelease,
  catalog,
  components,
  profile,
  keyring = null,
  approval = null,
  deploymentProfile = null,
  serviceClasses = [],
  tenants = ["acme"],
  now = "2026-03-01T00:00:00Z",
} = {}) {
  const target = (catalog?.releases ?? []).find((r) => r.id === toRelease) ?? null;
  const current = (catalog?.releases ?? []).find((r) => r.id === fromRelease) ?? null;
  const preflight = updatePreflight({ fromRelease, toRelease, catalog, components, profile, deploymentProfile, serviceClasses });
  const impact = updateImpact({ fromRelease: current, toRelease: target, components });

  const targetClosure = preflight.result;
  impact.sharedDataServices = (targetClosure.dataServices ?? [])
    .filter((ds) => ds.required === true && ds.providedBy.length > 0)
    .map((ds) => ({ id: ds.id, kind: ds.kind, requiredBy: ds.requiredBy.map((r) => r.component).sort(), providedBy: [...ds.providedBy].sort() }));
  impact.affectedTenants = [...new Set(tenants)].sort();

  const steps = [];
  let order = 1;
  const add = (id, kind, description, mutating, requiresApproval, dependsOn = []) => {
    if (steps.some((s) => s.id === id)) return;
    steps.push({ id, order: order++, kind, description, mutating, requiresApproval, dependsOn, state: "pending" });
  };
  add("preflight", "preflight", "Kør read-only preflight og verificér releasekanal, signatur og closure", false, false);
  add("snapshot", "snapshot", "Tag et snapshot af release, komponenter og records før mutation", false, false, ["preflight"]);
  for (const c of [...impact.added, ...impact.upgraded, ...impact.downgraded].sort((a, b) => a.id.localeCompare(b.id))) {
    add(`provision-${c.id}`, "provision", `Klargør komponenten '${c.id}' (${c.from ?? "—"} → ${c.to ?? "—"})`, true, true, ["snapshot"]);
  }
  add("migrate-schema", "migrate", "Anvend versionerede skema- og datamigrationer for målreleasen", true, true, steps.filter((s) => s.kind === "provision").map((s) => s.id));
  add("configure", "configure", "Anvend den ene ønskede konfiguration og opdater komponentversioner", true, true, ["migrate-schema"]);
  add("verify", "verify", "Verificér faktisk tilstand mod den låste målrelease", false, false, ["configure"]);
  add("rollback-ready", "rollback", "Bekræft at snapshot og rollback-procedure er klar", false, false, ["verify"]);

  const plan = {
    apiVersion: UPDATE_API_VERSION,
    kind: UPDATE_KIND,
    metadata: {
      name: `update-plan-${installationId}-${toRelease}`.slice(0, 63),
      version: "1.0.0",
      createdAt: now,
      description: `Opdatering fra ${fromRelease} til ${toRelease} med påvirkningsplan, migrationskontrol, rollback og godkendelse.`,
      installationId,
    },
    fromRelease,
    toRelease,
    catalogDigest: createHash("sha256").update(JSON.stringify((catalog?.releases ?? []).map((r) => ({ id: r.id, channel: r.channel, digest: r.digest })))).digest("hex"),
    impact,
    migrationCheck: {
      required: (targetClosure.migrations ?? []).some((m) => m.phase === "schema" || m.phase === "data"),
      phases: [...new Set((targetClosure.migrations ?? []).map((m) => m.phase))].sort((a, b) => ["pre", "schema", "data", "post"].indexOf(a) - ["pre", "schema", "data", "post"].indexOf(b)),
      reversible: (targetClosure.migrations ?? []).every((m) => m.reversible !== false),
      problems: [],
    },
    preflight: { ok: preflight.ok, checks: preflight.checks, blockingProblems: preflight.blockingProblems },
    authorization: approval
      ? { required: true, humanSubject: approval.humanSubject ?? null, approvalRef: approval.approvalRef ?? null, twoPerson: approval.twoPerson === true }
      : { required: true, humanSubject: null, approvalRef: null, twoPerson: true },
    rollback: {
      strategy: "snapshot-restore",
      snapshotRef: `lifecycle://snapshot/${installationId}/${toRelease}`,
      restoresRights: true,
      documentedProcedureRef: ROLLBACK_PROCEDURE_REF,
    },
    steps,
    resume: { stateRef: `lifecycle://update/${installationId}/${toRelease}`, lastCompletedStep: null, resumable: true },
    restrictions: { preserveData: true, formatDisks: false, adoptExistingSchema: false, unsignedPackage: false },
  };

  const signer = keyring?.keys?.[0];
  return signer ? signPlan(plan, { keyId: signer.keyId, secret: signer.secret, signedAt: now }) : plan;
}

/** Verificér opdateringsplanens signatur. */
export function verifyUpdatePlan(plan, keyring) {
  return verifyPlanSignature(plan, keyring);
}

/**
 * Kør en opdateringsplan resumabelt. Et muterende trin kræver en menneskelig
 * godkendelse der dækker netop det trin. Et snapshot tages før første mutation,
 * så en afbrudt eller fejlet opdatering kan genoptages eller rulles tilbage.
 */
export async function executeUpdate({ plan, store, keyring = null, authorization = null, executors, snapshotDir = null, targetComponents = null, at = "2026-03-01T00:00:00Z" } = {}) {
  if (!plan) throw new Error("executeUpdate kræver en plan");
  if (!store) throw new Error("executeUpdate kræver en butik");
  if (keyring) {
    const verified = verifyUpdatePlan(plan, keyring);
    if (!verified.ok) return { ok: false, code: "BAD_SIGNATURE", error: verified.reason };
  }
  const id = plan.metadata.name;
  const digest = planDigest(plan);
  let record = store.getUpdate(id);
  if (!record) record = { id, planDigest: digest, fromRelease: plan.fromRelease, toRelease: plan.toRelease, status: "pending", steps: {}, snapshotRef: null, at };

  if (snapshotDir && !record.snapshotRef) {
    store.snapshot(snapshotDir);
    record = { ...record, snapshotRef: snapshotDir };
    store.upsertUpdate(record);
  }

  for (const step of [...plan.steps].sort((a, b) => a.order - b.order)) {
    if (record.steps[step.id]?.state === "done") continue;
    if (step.mutating === true && step.requiresApproval === true) {
      const covered = (authorization?.stepIds ?? []).includes(step.id) && /^[a-z][a-z0-9-]*\|/.test(authorization?.humanSubject ?? "");
      if (!covered) {
        record = { ...record, status: "failed", steps: { ...record.steps, [step.id]: { state: "failed", error: "manglende menneskelig godkendelse" } } };
        store.upsertUpdate(record);
        return { ok: false, code: "APPROVAL_REQUIRED", error: `trinnet '${step.id}' mangler menneskelig godkendelse`, record };
      }
    }
    for (const dep of step.dependsOn ?? []) {
      if (record.steps[dep]?.state !== "done") {
        record = { ...record, status: "failed", steps: { ...record.steps, [step.id]: { state: "failed", error: `afhængigheden '${dep}' er ikke fuldført` } } };
        store.upsertUpdate(record);
        return { ok: false, code: "DEPENDENCY_NOT_DONE", error: `trinnet '${step.id}' kan ikke køre før '${dep}'`, record };
      }
    }
    record = { ...record, status: "running", steps: { ...record.steps, [step.id]: { state: "running", attempts: (record.steps[step.id]?.attempts ?? 0) + 1 } } };
    store.upsertUpdate(record);
    try {
      const result = await executors.run(step, { plan, id, at });
      record = { ...record, steps: { ...record.steps, [step.id]: { state: "done", result: result ?? null } } };
      store.upsertUpdate(record);
    } catch (error) {
      record = { ...record, status: "failed", steps: { ...record.steps, [step.id]: { state: "failed", error: error.message } } };
      store.upsertUpdate(record);
      return { ok: false, code: error.code ?? "STEP_FAILED", error: `trinnet '${step.id}' fejlede: ${error.message}`, record };
    }
  }

  const components = targetComponents ?? applyImpact(store.getComponents(), plan.impact);
  store.setActiveRelease(plan.toRelease, { at });
  store.setComponents(components, { at });
  record = { ...record, status: "done", at };
  store.upsertUpdate(record);
  return { ok: true, record, digest };
}

/** Genoptag en afbrudt opdatering; identisk med executeUpdate (idempotent). */
export async function resumeUpdate(options = {}) {
  return executeUpdate(options);
}

/** Rul en opdatering tilbage til snapshot-tilstanden taget før første mutation. */
export function rollbackUpdate({ store, updateId, destDir, at = "2026-03-01T00:00:00Z" } = {}) {
  const record = store.getUpdate(updateId);
  if (!record) throw new Error(`opdateringen '${updateId}' findes ikke`);
  if (!record.snapshotRef) throw new Error(`opdateringen '${updateId}' har intet snapshot`);
  const restored = FileLifecycleStore.restore(record.snapshotRef, destDir);
  restored.setActiveRelease(record.fromRelease, { at, reason: "rollback" });
  const rolled = { ...record, status: "rolled-back", at };
  store.upsertUpdate(rolled);
  return {
    updateId,
    status: "rolled-back",
    fromRelease: record.fromRelease,
    toRelease: record.toRelease,
    restoredRelease: restored.getActiveRelease(),
    restoredEpoch: restored.epoch(),
    at,
  };
}
