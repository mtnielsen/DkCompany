/**
 * DKC-049 — loggepolitikken som data.
 *
 * Politikken fastlægger korrelationsfelter, provenance-adskillelse, retention,
 * arkivlag med WORM og fejldomæner samt default-deny læseadgang. Denne fil
 * indlæser og efterprøver politikken; JSON Schema håndhæver formen, her
 * håndhæves beslutningerne.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const POLICY_PATH = "logging/logging-policy.json";

export function loadLoggingPolicy(root) {
  return JSON.parse(readFileSync(join(root, POLICY_PATH), "utf8"));
}

const RETENTION_CLASSES = ["operational", "personal", "security"];

export function policyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [{ path: "/", message: "politikken er ikke et objekt" }];
  if (policy.kind !== "LoggingPolicy") problems.push({ path: "/kind", message: "skal være 'LoggingPolicy'" });
  if (!policy.metadata?.name || !policy.metadata?.version) problems.push({ path: "/metadata", message: "name og version kræves" });

  const fields = new Set(policy.correlationFields ?? []);
  for (const required of ["correlationId", "executionId", "tenantId", "resource"]) {
    if (!fields.has(required)) problems.push({ path: "/correlationFields", message: `mangler det fælles felt '${required}'` });
  }

  const classes = policy.provenance?.classes ?? [];
  for (const cls of ["sensor", "model", "verified", "human", "system"]) {
    if (!classes.includes(cls)) problems.push({ path: "/provenance/classes", message: `provenance-klassen '${cls}' mangler` });
  }
  if (policy.provenance?.separated !== true) problems.push({ path: "/provenance/separated", message: "provenance-klasserne skal være adskilte" });

  for (const cls of RETENTION_CLASSES) {
    const days = policy.retention?.[cls];
    if (!Number.isInteger(days) || days < 1) problems.push({ path: `/retention/${cls}`, message: `retention for '${cls}' skal være et positivt heltal` });
  }

  const archive = policy.archive ?? {};
  const targets = archive.targets ?? [];
  if (!Number.isInteger(archive.minFailureDomains) || archive.minFailureDomains < 2) {
    problems.push({ path: "/archive/minFailureDomains", message: "mindst to uafhængige fejldomæner kræves" });
  }
  for (const required of ["personal", "security"]) {
    if (!(archive.requireImmutableFor ?? []).includes(required)) {
      problems.push({ path: "/archive/requireImmutableFor", message: `retention-klassen '${required}' skal kræve et immutabelt arkiv` });
    }
  }
  const domains = new Set(targets.map((t) => t.failureDomain));
  if (domains.size < (archive.minFailureDomains ?? 0)) {
    problems.push({ path: "/archive/targets", message: `arkivmålene dækker kun ${domains.size} fejldomæner, kræver ${archive.minFailureDomains}` });
  }
  for (const cls of archive.requireImmutableFor ?? []) {
    const immutable = targets.filter((t) => t.immutable === true && (t.dataClasses ?? []).includes(cls));
    if (immutable.length === 0) {
      problems.push({ path: "/archive/targets", message: `retention-klassen '${cls}' kræver mindst ét immutabelt (WORM) arkivmål` });
    }
    const immutableDomains = new Set(immutable.map((t) => t.failureDomain));
    if (immutableDomains.size < 2) {
      problems.push({ path: "/archive/targets", message: `retention-klassen '${cls}' kræver immutable kopier i mindst to fejldomæner` });
    }
  }
  for (const [i, t] of targets.entries()) {
    if (!(t.dataClasses ?? []).length) problems.push({ path: `/archive/targets/${i}/dataClasses`, message: "et arkivmål skal dække mindst én dataklasse" });
    if (!t.classification) problems.push({ path: `/archive/targets/${i}/classification`, message: "et arkivmål skal have en lagerklassifikation" });
  }

  if (policy.access?.defaultDeny !== true) problems.push({ path: "/access/defaultDeny", message: "logadgang skal være default-deny" });
  if (!(policy.access?.readerRoles ?? []).length) problems.push({ path: "/access/readerRoles", message: "mindst én læserrolle kræves" });
  if (policy.access?.auditAccess !== true) problems.push({ path: "/access/auditAccess", message: "logadgang skal selv logges" });

  if (!Number.isInteger(policy.timeSync?.maxSkewSeconds) || policy.timeSync.maxSkewSeconds < 0) problems.push({ path: "/timeSync/maxSkewSeconds", message: "maxSkewSeconds skal være et ikke-negativt heltal" });
  if (policy.timeSync?.monotonicSequences !== true) problems.push({ path: "/timeSync/monotonicSequences", message: "monotone sekvenser skal være slået til" });

  if (!(policy.redaction?.forbiddenReasoningKeys ?? []).length) problems.push({ path: "/redaction/forbiddenReasoningKeys", message: "skjulte ræsonneringsfelter skal være eksplicit forbudt" });
  return problems;
}

/** Arkivmål der dækker en given retention-klasse. */
export function archiveTargetsFor(policy, retentionClass) {
  return (policy?.archive?.targets ?? []).filter((t) => (t.dataClasses ?? []).includes(retentionClass));
}

/** Skal en given retention-klasse have en immutabel (WORM) kopi før mutation? */
export function requiresImmutableArchive(policy, retentionClass) {
  return (policy?.archive?.requireImmutableFor ?? []).includes(retentionClass);
}

export { RETENTION_CLASSES };
