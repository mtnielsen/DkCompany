/**
 * DKC-063 — den rene release-gate-evaluator.
 *
 * Gaten muterer intet. Den læser en baselinekørsel (evidens), testmatricen,
 * trusselregisteret, risikoundtagelser og uafhængige vurderinger og svarer på
 * ét spørgsmål: kan denne kørsel bære en release?
 *
 * Grundregler:
 *   - failed, skipped, not-run, unsupported, stale og wrong-artifact er
 *     distinkte statusser; KUN 'passed' tæller som bestået,
 *   - evidens skal binde commit, artefakt-digest, profil, miljø, producent,
 *     kommando og tidsstempler,
 *   - en implementør kan ikke levere uafhængig verifikation,
 *   - en udløbet eller ikke-ejergodkendt undtagelse er ikke en undtagelse.
 */
import { createHash } from "node:crypto";

const DAY_MS = 1000 * 60 * 60 * 24;
const ALL_STATUSES = [
  "passed",
  "failed",
  "skipped",
  "not-run",
  "unsupported",
  "stale",
  "wrong-artifact",
  "missing",
  "pending-independent-assessment",
  "excepted",
];
const RANK = Object.fromEntries(ALL_STATUSES.map((s, i) => [s, i]));

const STATUS_COUNT_KEYS = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
  "not-run": "notRun",
  unsupported: "unsupported",
  stale: "stale",
  "wrong-artifact": "wrongArtifact",
  missing: "missing",
  "pending-independent-assessment": "pendingIndependentAssessment",
  excepted: "excepted",
};

function ageDays(fromIso, now) {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return Infinity;
  return (now - from) / DAY_MS;
}

function worst(statuses) {
  if (statuses.length === 0) return "passed";
  return statuses.reduce((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "passed");
}

export function digestOf(value) {
  return "sha256:" + createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function normalizeBaselineStatus(raw) {
  if (!raw) return "missing";
  switch (raw.status) {
    case "pass":
      return "passed";
    case "fail":
    case "error":
      return "failed";
    case "skipped":
      return "skipped";
    case "not-run":
    case "notRun":
      return "not-run";
    case "unsupported":
      return "unsupported";
    default:
      return "unsupported";
  }
}

function exceptionApplies(exception, requirementId, checkId, now, maxDays) {
  if (!exception) return null;
  if (exception.requirementId !== requirementId) return null;
  if (exception.status === "closed") return null;
  if (exception.checkId && exception.checkId !== checkId) return null;
  const expires = Date.parse(exception.expiresAt);
  const approved = Date.parse(exception.approvedAt);
  if (!Number.isFinite(expires) || !Number.isFinite(approved)) return null;
  if (expires <= now || approved > now) return null;
  if (Number.isFinite(maxDays) && (expires - approved) / DAY_MS > maxDays) return null;
  return exception;
}

function validAssessment(assessment, requirementId, targetCommit, now) {
  if (!assessment || assessment.requirementId !== requirementId) return null;
  const performed = Date.parse(assessment.performedAt);
  const expires = Date.parse(assessment.expiresAt);
  if (!Number.isFinite(performed) || !Number.isFinite(expires)) return null;
  if (performed > now || expires <= now) return null;
  if (assessment.targetCommit && targetCommit && assessment.targetCommit !== targetCommit) return null;
  return assessment;
}

/**
 * @param {object} options
 * @param {object} options.baseline        BaselineResult fra tools/baseline
 * @param {object} options.matrix          TestMatrix
 * @param {Array}  options.registry        CHECKS fra tools/baseline/registry.mjs
 * @param {object} [options.exceptions]    RiskExceptions
 * @param {object} [options.assessments]   IndependentAssessment
 * @param {object} [options.threats]       ThreatRegister
 * @param {number|Date} [options.now]
 * @param {string} [options.targetCommit]
 * @param {string} [options.artifactDigest]
 * @param {object} [options.producer]
 * @param {string} [options.profile]
 */
export function evaluateGate(options = {}) {
  const {
    baseline = {},
    matrix = {},
    registry = [],
    exceptions = { exceptions: [] },
    assessments = { assessments: [] },
    threats = { threats: [] },
    now: nowInput = Date.now(),
    targetCommit: targetCommitInput = null,
    artifactDigest: artifactDigestInput = null,
    producer = { type: "implementer", name: "baseline", subject: "process|baseline" },
    profile = "default",
  } = options;

  const now = nowInput instanceof Date ? nowInput.getTime() : typeof nowInput === "string" ? Date.parse(nowInput) : Number(nowInput);
  const registryById = new Map(registry.map((c) => [c.id, c]));
  const baselineById = new Map((baseline.checks ?? []).map((c) => [c.id, c]));
  const generatedAt = baseline.generatedAt ?? null;
  const baselineCommit = baseline.environment?.git?.commit ?? baseline.commit ?? null;
  const targetCommit = targetCommitInput ?? baselineCommit;
  const artifactDigest = artifactDigestInput ?? digestOf(baseline);
  const thresholds = matrix.thresholds ?? {};
  const maxExceptionDays = thresholds.maxExceptionDays;
  const allowImplementer = thresholds.allowImplementerEvidenceForRelease === true;
  const maxOpenExceptions = Number.isInteger(thresholds.maxOpenExceptions) ? thresholds.maxOpenExceptions : 0;

  const globalReasons = [];
  const commitMismatch = Boolean(baselineCommit && targetCommit && baselineCommit !== targetCommit);
  if (commitMismatch) globalReasons.push(`evidensen er bundet til commit ${baselineCommit}, men release-målet er ${targetCommit}`);
  if (!generatedAt) globalReasons.push("evidensen mangler et genereringstidspunkt og kan ikke frisktidsvurderes");
  if (!baseline.environment?.git?.commit) globalReasons.push("evidensen mangler commit-binding");
  if (!baseline.environment?.node) globalReasons.push("evidensen mangler miljøbinding (node)");
  if (!baseline.summary) globalReasons.push("evidensen mangler et resumé");

  const thresholdsAccepted = Boolean(thresholds.acceptedBy?.subject && thresholds.acceptedBy?.name && thresholds.acceptedAt) && thresholds.acceptedBy?.role !== "team";
  if (!thresholdsAccepted) globalReasons.push("tærsklerne er ikke accepteret af et navngivet menneske; release må ikke erklæres grøn");

  // Anvend kun så mange undtagelser som tærsklen tillader.
  let exceptionsBudget = maxOpenExceptions;
  const exceptionByReq = new Map();
  for (const e of exceptions.exceptions ?? []) {
    if (exceptionByReq.has(e.requirementId)) continue;
    exceptionByReq.set(e.requirementId, e);
  }

  const requirements = (matrix.requirements ?? []).map((req) => {
    const freshnessDays = req.evidenceFreshnessDays ?? matrix.freshnessPolicy?.defaultDays ?? 30;
    const appliedException = [];
    const checks = (req.checks ?? []).map((ref) => {
      const reg = registryById.get(ref.id) ?? {};
      const raw = baselineById.get(ref.id);
      let status = normalizeBaselineStatus(raw);
      let stale = false;
      let wrongArtifact = false;
      let reason = raw?.reason ?? null;

      if (status === "passed" && generatedAt && ageDays(generatedAt, now) > freshnessDays) {
        status = "stale";
        stale = true;
        reason = `evidensen er ${Math.floor(ageDays(generatedAt, now))} dage gammel; fristen er ${freshnessDays}`;
      }
      if (commitMismatch || (artifactDigestInput && baseline.artifactDigest && baseline.artifactDigest !== artifactDigestInput)) {
        if (status === "passed" || status === "stale") {
          status = "wrong-artifact";
          wrongArtifact = true;
          reason = commitMismatch ? "forkert commit" : "forkert artefakt-digest";
        }
      }

      // Risikoundtagelse: må ikke dække nonExcepted-krav.
      if (status !== "passed" && status !== "missing" && !req.nonExcepted && exceptionsBudget > 0) {
        const candidate = exceptionApplies(exceptionByReq.get(req.id), req.id, ref.id, now, maxExceptionDays);
        if (candidate) {
          appliedException.push(candidate);
          exceptionsBudget -= 1;
          status = "excepted";
          reason = `dækket af ${candidate.id}: ${candidate.reason}`;
        }
      }

      return {
        id: ref.id,
        status,
        mustPass: ref.mustPass !== false,
        testTypes: ref.testTypes ?? [],
        level: reg.level ?? null,
        component: reg.component ?? null,
        command: raw?.command ?? reg.command ?? [],
        producer: producer.type,
        commit: baselineCommit,
        artifactDigest,
        profile,
        environment: {
          node: baseline.environment?.node ?? null,
          platform: baseline.environment?.platform ?? null,
          arch: baseline.environment?.arch ?? null,
        },
        startedAt: raw?.startedAt ?? null,
        finishedAt: raw?.finishedAt ?? null,
        evidenceRef: raw?.log ?? null,
        freshnessDays,
        ageDays: generatedAt ? Number(ageDays(generatedAt, now).toFixed(2)) : null,
        stale,
        wrongArtifact,
        reason,
        exception: status === "excepted" ? appliedException.at(-1)?.id ?? null : null,
      };
    });

    const mustPassChecks = checks.filter((c) => c.mustPass);
    const passingTypes = new Set(checks.filter((c) => c.status === "passed").flatMap((c) => c.testTypes));
    const declaredTypes = new Set(checks.flatMap((c) => c.testTypes));
    const coveredTestTypes = (req.testTypes ?? []).filter((t) => passingTypes.has(t));

    const assessmentRequired = req.independentAssessment?.required === true;
    const checkMissingTestTypes = (req.testTypes ?? []).filter((t) => !declaredTypes.has(t));
    const missingTestTypes = assessmentRequired ? [] : checkMissingTestTypes;
    const statuses = mustPassChecks.map((c) => c.status);
    if (missingTestTypes.length) statuses.push("missing");
    let status = worst(statuses);
    let independentAssessment = null;
    if (assessmentRequired && status === "passed") {
      const candidate = validAssessment((assessments.assessments ?? []).find((a) => a.requirementId === req.id), req.id, targetCommit, now);
      const accepted = candidate && (producer.type !== "implementer" || allowImplementer);
      independentAssessment = accepted ? candidate : null;
      status = accepted ? "passed" : "pending-independent-assessment";
    }

    const reasons = [];
    for (const c of mustPassChecks) {
      if (c.status !== "passed") reasons.push(`check '${c.id}' er '${c.status}'${c.reason ? `: ${c.reason}` : ""}`);
    }
    if (missingTestTypes.length) reasons.push(`manglende testtyper uden en check: ${missingTestTypes.join(", ")}`);
    if (assessmentRequired && checkMissingTestTypes.length) reasons.push(`testtyper dækket af den uafhængige vurdering: ${checkMissingTestTypes.join(", ")}`);
    if (status === "pending-independent-assessment") reasons.push(`kræver en gyldig uafhængig vurdering (${req.independentAssessment.evidenceKind}); en implementørkørsel tæller ikke`);

    const blocking = Boolean(req.mandatory && req.releaseBlocking && status !== "passed" && status !== "excepted");
    return {
      requirementId: req.id,
      title: req.title,
      mandatory: req.mandatory,
      releaseBlocking: req.releaseBlocking,
      nonExcepted: req.nonExcepted,
      status,
      blocking,
      testTypes: req.testTypes ?? [],
      coveredTestTypes,
      missingTestTypes,
      checks,
      independentAssessment,
      exception: appliedException.at(-1) ?? null,
      reasons,
    };
  });

  const statuses = { total: requirements.length, passed: 0, failed: 0, skipped: 0, notRun: 0, unsupported: 0, stale: 0, wrongArtifact: 0, missing: 0, pendingIndependentAssessment: 0, excepted: 0, blocking: 0 };
  for (const r of requirements) {
    statuses[STATUS_COUNT_KEYS[r.status]] = (statuses[STATUS_COUNT_KEYS[r.status]] ?? 0) + 1;
    if (r.blocking) statuses.blocking += 1;
  }

  const openExceptions = requirements.filter((r) => r.status === "excepted" && r.exception).map((r) => ({ requirementId: r.requirementId, exceptionId: r.exception.id, owner: r.exception.owner?.name ?? null }));

  let decision = "eligible";
  if (statuses.blocking > 0) decision = "blocked";
  else if (statuses.excepted > 0) decision = "eligible-with-exceptions";
  if (!thresholdsAccepted) decision = "blocked";

  const threatEntries = (threats.threats ?? []).map((t) => {
    const reqs = requirements.filter((r) => (t.requirementIds ?? []).includes(r.requirementId));
    const status = worst(reqs.map((r) => r.status));
    return { id: t.id, boundary: t.boundary, title: t.title, status, requirementIds: t.requirementIds ?? [], residualRisk: t.residualRisk };
  });

  return {
    schemaVersion: 1,
    kind: "ReleaseGateResult",
    generatedAt: new Date(now).toISOString(),
    matrixVersion: matrix.matrixVersion ?? matrix.metadata?.version ?? "unknown",
    targetCommit,
    artifactDigest,
    artifactKind: "baseline-result",
    producer,
    profile,
    environment: baseline.environment ?? {},
    thresholds,
    decision,
    statuses,
    requirements,
    threats: threatEntries,
    openExceptions,
    reasons: globalReasons,
  };
}
