/**
 * DKC-065 — import af fund og retest.
 *
 * En assessor (eller en scanner) rapporterer i sit eget format. Importen
 * normaliserer til den kanoniske fundmodel, binder hvert fund til den artefakt
 * det gælder, bevarer proveniensen og **redigerer** secrets/persondata ud af
 * evidensen før noget gemmes. Et retest må kun lukke et fund når det peger på
 * det rettede artefakt; et andet artefakt kræver en eksplicit impact review.
 */
import { redactSecrets } from "../../persistence/src/redact.mjs";

export const IMPORT_CATEGORIES = ["auth", "direct-apis", "cross-tenant-access", "injection", "agent-role-approval-bypass", "host-broker", "connectors", "telemetry-leaks", "immutable-bypass"];
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const FINDING_STATUSES = ["open", "retest-pending", "fixed", "accepted", "false-positive"];

function slug(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function normalizeFindingRef(ref) {
  const body = slug(ref) || "UNKNOWN";
  return `FIND-${body}`.slice(0, 40);
}

export function normalizeRetestRef(ref) {
  const body = slug(ref) || "UNKNOWN";
  return `RETEST-${body}`.slice(0, 40);
}

/**
 * Importér rå fund. `defaultArtifactDigest` bruges når fundet ikke selv angiver
 * en digest. Returnerer `{ findings, redactions }`.
 */
export function importFindings(raw, { artifactDigest = null, source = "independent-assessor", now = 0 } = {}) {
  const redactions = [];
  const findings = [];
  for (const entry of raw?.findings ?? []) {
    const evidence = redactSecrets(
      {
        description: entry.evidence ?? entry.description ?? "",
        raw: entry.rawEvidence ?? null,
        reference: entry.reference ?? null,
      },
      { redactions }
    );
    const severity = SEVERITIES.includes(entry.severity) ? entry.severity : "info";
    findings.push({
      id: normalizeFindingRef(entry.ref ?? entry.id),
      category: IMPORT_CATEGORIES.includes(entry.category) ? entry.category : "direct-apis",
      source: ["local-regression-harness", "independent-assessor", "scanner"].includes(source) ? source : "independent-assessor",
      severity,
      impact: String(entry.impact ?? entry.description ?? "ikke beskrevet").slice(0, 500) || "ikke beskrevet",
      reproducible: entry.reproducible === true,
      evidenceRef: `import:${slug(entry.ref ?? entry.id)}`,
      affectedArtifactDigest: entry.affectedArtifactDigest ?? artifactDigest ?? "sha256:" + "0".repeat(64),
      remediation: {
        owner: entry.remediation?.owner ?? raw?.metadata?.accountableHuman ?? null,
        handoffRef: entry.remediation?.handoffRef ?? `handoff:${slug(entry.ref ?? entry.id)}`,
        dueAt: entry.remediation?.dueAt ?? new Date(now).toISOString(),
        status: ["open", "in-progress", "resolved"].includes(entry.remediation?.status) ? entry.remediation.status : "open",
      },
      status: FINDING_STATUSES.includes(entry.status) ? entry.status : "open",
      ...(entry.exception ? { exception: entry.exception } : {}),
      _evidence: evidence,
    });
  }
  return { findings, redactions };
}

/**
 * Importér retest og bind dem til fundene. Et retest der peger på et andet
 * artefakt end den aktuelle binding markeres `artifactChanged`, så gaten kan
 * kræve en impact review.
 */
export function importRetests(raw, { findings = [], currentArtifactDigest = null, now = 0 } = {}) {
  const findingIds = new Set(findings.map((f) => f.id));
  const retests = [];
  const problems = [];
  for (const entry of raw?.retests ?? []) {
    const findingId = normalizeFindingRef(entry.findingRef ?? entry.findingId);
    if (!findingIds.has(findingId)) {
      problems.push(`retest peger på det ukendte fund '${findingId}'`);
      continue;
    }
    const fixedArtifactDigest = entry.fixedArtifactDigest ?? currentArtifactDigest;
    retests.push({
      id: normalizeRetestRef(entry.ref ?? entry.id),
      findingId,
      performedAt: entry.performedAt ?? new Date(now).toISOString(),
      performedBy: entry.performedBy ?? raw?.metadata?.accountableHuman ?? null,
      fixedArtifactDigest,
      result: entry.result === "failed" ? "failed" : "passed",
      evidenceRef: `import:${slug(entry.ref ?? entry.id)}`,
      artifactChanged: Boolean(currentArtifactDigest && fixedArtifactDigest && fixedArtifactDigest !== currentArtifactDigest),
    });
  }
  return { retests, problems };
}

/**
 * Anvend importerede fund/retest på en vurdering og afgør om en impact review
 * er påkrævet. Returnerer en ny vurdering (input muteres ikke).
 */
export function applyImports(assessment, { findings = [], retests = [], impactReview = null } = {}) {
  const next = JSON.parse(JSON.stringify(assessment));
  next.findings = findings.map(({ _evidence, ...rest }) => rest);
  next.retests = retests.map(({ artifactChanged, ...rest }) => rest);
  const assessmentArtifact = next.independentAssessment?.artifactDigest ?? null;
  const currentArtifact = next.artifactBinding?.artifactDigest ?? null;
  const artifactChangedAfterAssessment = Boolean(assessmentArtifact && currentArtifact && assessmentArtifact !== currentArtifact);
  if (artifactChangedAfterAssessment && !impactReview) {
    next.impactReview = null;
  } else if (impactReview) {
    next.impactReview = impactReview;
  }
  return { assessment: next, artifactChangedAfterAssessment, impactReviewRequired: artifactChangedAfterAssessment && !impactReview };
}
