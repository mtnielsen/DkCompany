/**
 * DKC-061 — redigerede supportbundles, diagnostik og ingen skjult fjernadgang.
 *
 * Bundlen bygges ud fra en allowlist. Alle hemmeligheder redigeres, og både
 * indholdet og strukturen scannes for hemmeligheds- og HR-signaturer før bundlen
 * skrives. Et fund blokerer (fail-closed). Fjernadgang er slået fra som standard,
 * må aldrig være skjult, og kræver et navngivent menneskes samtykke med en TTL
 * og et revisionsspor.
 */
import { buildDiagnostics, redactSecrets, scanForSecrets } from "./diagnostics.mjs";
import { scanForbiddenContent, supportBundleDigest } from "./lifecycle-model.mjs";

export const SUPPORT_API_VERSION = "contracts.platform/v1alpha1";
export const SUPPORT_KIND = "SupportBundle";

export class SupportBundleError extends Error {
  constructor(message, code = "support_bundle_rejected") {
    super(message);
    this.name = "SupportBundleError";
    this.code = code;
  }
}

/**
 * Byg en redigeret supportbundle. `sources` er en map fra allowlist-id til det
 * rå indhold. Kilder der ikke er på allowlisten afvises, og indhold der indeholder
 * hemmeligheder eller HR-data blokerer.
 */
export function buildSupportBundle({
  policy,
  installationId,
  sources = {},
  remoteAccess = { enabled: false },
  at = "2026-03-01T00:00:00Z",
} = {}) {
  if (!policy) throw new SupportBundleError("supportpolitikken mangler", "NO_POLICY");
  const allow = new Map((policy.allowlist ?? []).map((e) => [e.id, e]));
  const collected = [];
  const content = {};
  for (const [id, raw] of Object.entries(sources)) {
    const entry = allow.get(id);
    if (!entry) throw new SupportBundleError(`kilden '${id}' er ikke på allowlisten`, "SOURCE_NOT_ALLOWED");
    const secretFindings = scanForSecrets(raw);
    if (secretFindings.length) throw new SupportBundleError(`kilden '${id}' indeholder hemmelighedssignaturer: ${secretFindings.join(", ")}`, "SECRET_LEAK");
    const forbidden = scanForbiddenContent(raw);
    if (forbidden.length) throw new SupportBundleError(`kilden '${id}' indeholder ikke-godkendt HR-/følsomt indhold: ${forbidden.join(", ")}`, "HR_LEAK");
    const redacted = redactSecrets(raw);
    content[id] = redacted;
    collected.push({ id, source: entry.source, dataClass: entry.dataClass, digest: supportBundleDigest(redacted) });
  }

  // Fjernadgang er default-deny: en aktiveret adgang skal have et navngivent
  // menneskes samtykke og en positiv TTL inden for politikken.
  const enabled = remoteAccess.enabled === true;
  const maxTtl = policy.policy?.remoteAccessMaxTtlMinutes ?? 480;
  if (policy.policy?.hiddenRemoteAccessAllowed !== false) throw new SupportBundleError("skjult fjernadgang må ikke tillades", "HIDDEN_ACCESS_ALLOWED");
  if (enabled) {
    if (!/^[a-z][a-z0-9-]*\|/.test(remoteAccess.consentRef ?? "")) throw new SupportBundleError("aktiveret fjernadgang kræver et navngivent menneskes samtykke", "CONSENT_REQUIRED");
    if (!(remoteAccess.ttlMinutes >= 1 && remoteAccess.ttlMinutes <= maxTtl)) throw new SupportBundleError(`fjernadgangens TTL skal være mellem 1 og ${maxTtl} minutter`, "BAD_TTL");
  }

  const diagnostics = buildDiagnostics({
    artifactRef: `support://${installationId}/bundle`,
    payload: { installationId, collected: collected.map((c) => c.id), remoteAccess: { enabled } },
  });

  const bundle = {
    apiVersion: SUPPORT_API_VERSION,
    kind: SUPPORT_KIND,
    metadata: {
      name: `support-bundle-${installationId}`.slice(0, 63),
      version: "1.0.0",
      generatedAt: at,
      description: "Redigeret supportbundle med diagnostik uden hemmeligheder eller ikke-godkendt HR-indhold.",
      installationId,
    },
    policyRef: "support/policy.json",
    redacted: true,
    secretScan: "pass",
    hrScan: "pass",
    collected,
    excluded: (policy.allowlist ?? []).filter((e) => !(e.id in sources)).map((e) => ({ id: e.id, reason: "ikke indsamlet i denne bundle" })),
    remoteAccess: {
      enabled,
      hiddenAccess: false,
      consentRef: enabled ? remoteAccess.consentRef : null,
      ttlMinutes: enabled ? remoteAccess.ttlMinutes : null,
    },
    diagnostics: { redacted: diagnostics.redacted, secretScan: diagnostics.secretScan, artifactRef: diagnostics.artifactRef },
    content,
    digest: "0".repeat(64),
  };
  bundle.digest = supportBundleDigest(bundle);
  return bundle;
}

/** Bekræft at bundlen hverken indeholder skjult fjernadgang eller hemmeligheder. */
export function assertNoHiddenRemoteAccess(bundle) {
  const problems = [];
  if (bundle?.remoteAccess?.hiddenAccess === true) problems.push("skjult fjernadgang");
  if (bundle?.remoteAccess?.enabled === true && !bundle.remoteAccess.consentRef) problems.push("fjernadgang uden samtykke");
  const secretFindings = scanForSecrets(bundle?.content ?? {});
  if (secretFindings.length) problems.push(`hemmelighedssignaturer: ${secretFindings.join(", ")}`);
  const hrFindings = scanForbiddenContent(bundle?.content ?? {});
  for (const f of hrFindings) problems.push(`forbudt indhold: ${f}`);
  if (problems.length) throw new SupportBundleError(`supportbundlen blev afvist: ${problems.join("; ")}`, "BUNDLE_REJECTED");
  return { ok: true, problems: [] };
}

/** Simulér et diagnostikforsøg med hemmeligheder; skal blokere. */
export function diagnosticsMustRedact(payload) {
  try {
    return buildDiagnostics({ artifactRef: "support://diagnostics", payload });
  } catch (error) {
    return { redacted: true, secretScan: "fail", error: error.code };
  }
}
