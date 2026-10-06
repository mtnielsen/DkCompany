/**
 * DKC-065 — model og beslutningssemantik for sikkerhedsvurderingen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - et forberedt engagement (rules of engagement) autoriserer kun lokale,
 *     syntetiske regressioner; et eksternt mål kræver en navngivet menneskelig
 *     scope-godkendelse,
 *   - vurderingens dækning er versioneret og bundet til konkrete sonder og
 *     checks; en manglende eller fejlende dækning er ikke grøn,
 *   - fund og retest er bundet til det artefakt de gælder; et retest af et
 *     andet artefakt er ikke et bevis for denne version,
 *   - kun en gyldig, frisk og artefaktbundet **uafhængig** vurdering udført af
 *     et navngivet menneske, der ikke er implementøren, kan bære en
 *     produktionsgate,
 *   - ændringer efter vurderingen kræver en eksplicit impact review,
 *   - et navngivet menneske skal træffe releasebeslutningen.
 *
 * Valideringsfunktionerne returnerer arrays af `{ path, message }`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { HARNESS_CATEGORIES } from "./harness.mjs";

export const ROE_PATH = "security-assessment/rules-of-engagement.json";
export const ASSESSMENT_PATH = "security-assessment/assessment.json";
export const REPORT_PATH = "security-assessment/report/security-assessment-report.json";
export const REPORT_DOC_PATH = "docs/release/security-assessment.md";
export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";
export const TARGET_COMMIT = "83ad91a963d8055f77c29fb4361455689df95acb";
export const ASSESSMENT_VERSION = "1.0.0";
export const PRODUCER = { type: "implementer", name: "security-assessment-suite", subject: "process|security-assessment-suite" };
export const OPEN_SEVERITIES = ["critical", "high"];
export const COVERAGE_IDS = HARNESS_CATEGORIES;

/** Komponenter og deres kildetræer; bruges til den deterministiske artefaktbinding. */
export const PROFILE_INVENTORY = [
  { component: "telemetry-api", path: "telemetry-api" },
  { component: "agent-registry", path: "agent-registry" },
  { component: "host-management", path: "host-management" },
  { component: "adapter-sdk", path: "adapter-sdk" },
  { component: "storage", path: "storage" },
  { component: "runtime", path: "runtime" },
  { component: "identity", path: "identity" },
  { component: "credentials", path: "credentials" },
  { component: "approvals", path: "approvals" },
];

function err(path, message) {
  return { path, message };
}

export function sha256(value) {
  return "sha256:" + createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadRulesOfEngagement(root) {
  return readJson(root, ROE_PATH);
}
export function loadAssessment(root) {
  return readJson(root, ASSESSMENT_PATH);
}

/* -------------------------------------------------------------------------- */
/* Deterministisk artefaktbinding                                             */
/* -------------------------------------------------------------------------- */

function walkFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry === "node_modules" || entry === ".git" || entry === ".conformance-out") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkFiles(full, base));
    else if (stat.isFile()) out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

/** SHA256 over et kildetræ: sti + bytes pr. fil, sorteret. */
export function sha256Tree(root, rel) {
  const dir = join(root, rel);
  const files = walkFiles(dir);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(dir, file)));
    hash.update("\0");
  }
  return "sha256:" + hash.digest("hex");
}

/** Den samlede artefakt-digest for commit + den erklærede profilbeholdning. */
export function computeArtifactBinding(root, { targetCommit = TARGET_COMMIT, inventory = PROFILE_INVENTORY } = {}) {
  const profileInventory = inventory.map((entry) => ({ component: entry.component, digest: sha256Tree(root, entry.path) }));
  const artifactDigest = sha256({ targetCommit, profileInventory });
  return { targetCommit, artifactDigest, profileInventory };
}

/* -------------------------------------------------------------------------- */
/* Rules of engagement                                                        */
/* -------------------------------------------------------------------------- */

function personsEqual(a, b) {
  return Boolean(a?.subject) && a.subject === b?.subject;
}

export function rulesOfEngagementProblems(roe, { now = Date.now() } = {}) {
  const problems = [];
  if (!roe || typeof roe !== "object") return [err("/", "rules of engagement mangler")];
  if (!isNamedHuman(roe.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "engagementet skal have et navngivet menneske som ejer"));

  const authorization = roe.authorization ?? {};
  if (authorization.approved === true) {
    if (!isNamedHuman(authorization.approvedBy)) problems.push(err("/authorization/approvedBy", "en godkendt scope skal være godkendt af et navngivet menneske"));
    if (!authorization.approvedAt) problems.push(err("/authorization/approvedAt", "en godkendt scope skal have et godkendelsestidspunkt"));
    if (!authorization.reference) problems.push(err("/authorization/reference", "en godkendt scope skal have en reference"));
  } else {
    if (authorization.approvedBy) problems.push(err("/authorization/approvedBy", "en ikke-godkendt scope må ikke have en godkender"));
    if (authorization.approvedAt) problems.push(err("/authorization/approvedAt", "en ikke-godkendt scope må ikke have et godkendelsestidspunkt"));
  }
  if (roe.preparationOnly === true && authorization.approved === true) {
    problems.push(err("/preparationOnly", "et forberedelsesdokument må ikke samtidig være en godkendt levende autorisation"));
  }

  const targetIds = (roe.targets ?? []).map((t) => t.id);
  if (new Set(targetIds).size !== targetIds.length) problems.push(err("/targets", "mål-id'er skal være unikke"));
  for (const [i, target] of (roe.targets ?? []).entries()) {
    const at = (suffix) => `/targets/${i}${suffix}`;
    if (target.authorized === true) {
      if (!target.authorizationRef) problems.push(err(at("/authorizationRef"), "et autoriseret mål skal have en autorisationsreference"));
      const isLocalSynthetic = target.kind === "loopback" && target.syntheticOnly === true && target.dataClassification === "synthetic";
      if (!isLocalSynthetic && authorization.approved !== true) {
        problems.push(err(at("/authorized"), `målet '${target.id}' er autoriseret uden en navngivet scope-godkendelse`));
      }
      if (target.environment === "production") problems.push(err(at("/environment"), "produktionsmål må ikke autoriseres af dette engagement"));
      if (target.kind === "external") problems.push(err(at("/kind"), "eksterne mål kræver en særskilt, uafhængig autorisation"));
    }
  }

  const identityIds = (roe.identities ?? []).map((x) => x.id);
  if (new Set(identityIds).size !== identityIds.length) problems.push(err("/identities", "identitets-id'er skal være unikke"));
  const assessors = (roe.identities ?? []).filter((x) => x.kind === "assessor");
  const implementers = (roe.identities ?? []).filter((x) => x.kind === "implementer");
  for (const [i, identity] of (roe.identities ?? []).entries()) {
    if (identity.kind === "assessor" && !isNamedHuman({ subject: identity.subject, name: identity.name, role: identity.role })) {
      problems.push(err(`/identities/${i}`, "en assessor skal være et navngivet menneske"));
    }
  }
  for (const assessor of assessors) {
    for (const implementer of implementers) {
      if (assessor.subject === implementer.subject) problems.push(err("/identities", "assessor og implementer må ikke være samme aktør"));
    }
  }

  const techniqueIds = (roe.techniques ?? []).map((x) => x.id);
  if (new Set(techniqueIds).size !== techniqueIds.length) problems.push(err("/techniques", "teknik-id'er skal være unikke"));
  for (const [i, technique] of (roe.techniques ?? []).entries()) {
    if (roe.preparationOnly === true && technique.destructive === true && technique.allowed === true) {
      problems.push(err(`/techniques/${i}/allowed`, "et forberedelsesengagement må ikke tillade destruktive teknikker"));
    }
  }

  const from = Date.parse(roe.window?.from ?? "");
  const to = Date.parse(roe.window?.to ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) problems.push(err("/window", "tidsvinduet skal have et gyldigt interval"));
  if (roe.window?.status === "open" && Number.isFinite(from) && Number.isFinite(to) && (now < from || now > to)) {
    problems.push(err("/window/status", "et åbent tidsvindue ligger uden for 'nu'; scope er udløbet"));
  }

  if ((roe.exclusions ?? []).length === 0) problems.push(err("/exclusions", "engagementet skal have mindst én udelukkelse"));
  const eh = roe.evidenceHandling ?? {};
  if (eh.redactionRequired !== true) problems.push(err("/evidenceHandling/redactionRequired", "bevis skal kræve redaktion af secrets og persondata"));
  if (!(eh.accessControl ?? "").trim()) problems.push(err("/evidenceHandling/accessControl", "bevis skal være adgangskontrolleret"));
  if (!(eh.provenance ?? "").trim()) problems.push(err("/evidenceHandling/provenance", "bevis skal bevare proveniens"));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Effective finding status                                                    */
/* -------------------------------------------------------------------------- */

const DAY_MS = 1000 * 60 * 60 * 24;

export function effectiveFindingStatus(finding, { now = Date.now() } = {}) {
  if (!finding) return "open";
  if (finding.status === "accepted") {
    const exception = finding.exception;
    if (!exception || !isNamedHuman(exception.acceptedBy)) return "open";
    const expires = Date.parse(exception.expiresAt ?? "");
    if (!Number.isFinite(expires) || expires <= now) return "reopened";
    if ((exception.compensatingControls ?? []).length === 0) return "open";
    return "accepted";
  }
  if (finding.status === "false-positive") {
    return finding.verifiedBy ? "false-positive" : "open";
  }
  return finding.status ?? "open";
}

/* -------------------------------------------------------------------------- */
/* Assessment semantics                                                        */
/* -------------------------------------------------------------------------- */

export function securityAssessmentProblems(assessment, { now = Date.now(), roe = null, expectedCommit = null, expectedArtifactDigest = null, producerSubject = PRODUCER.subject, checkIds = null, openSeverities = OPEN_SEVERITIES } = {}) {
  const problems = [];
  if (!assessment || typeof assessment !== "object") return [err("/", "sikkerhedsvurderingen mangler")];
  if (!isNamedHuman(assessment.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "vurderingen skal have et navngivet menneske som ejer"));
  if (assessment.measured === true) problems.push(err("/measured", "en implementørkørsel må ikke erklæres som en målt uafhængig vurdering"));

  const binding = assessment.artifactBinding ?? {};
  if (expectedCommit && binding.targetCommit !== expectedCommit) problems.push(err("/artifactBinding/targetCommit", "vurderingen er bundet til et andet commit end målet"));
  if (expectedArtifactDigest && binding.artifactDigest !== expectedArtifactDigest) problems.push(err("/artifactBinding/artifactDigest", "vurderingen er bundet til et andet artefakt end målet"));
  const components = (binding.profileInventory ?? []).map((entry) => entry.component);
  if (new Set(components).size !== components.length) problems.push(err("/artifactBinding/profileInventory", "profilbeholdningen gentager en komponent"));

  // Dækning: de ni versionerede kategorier skal være til stede, og en bestået
  // kategori må kun referere til sonder der faktisk bestod.
  const coverageIds = (assessment.coverage ?? []).map((c) => c.id);
  if (new Set(coverageIds).size !== coverageIds.length) problems.push(err("/coverage", "dæknings-id'er skal være unikke"));
  for (const id of COVERAGE_IDS) {
    if (!coverageIds.includes(id)) problems.push(err("/coverage", `dækningen mangler kategorien '${id}'`));
  }
  const probesById = new Map();
  for (const run of assessment.harnessRuns ?? []) {
    for (const p of run.probes ?? []) probesById.set(p.id, p);
  }
  for (const [i, c] of (assessment.coverage ?? []).entries()) {
    const at = (suffix) => `/coverage/${i}${suffix}`;
    if (!c.required) problems.push(err(at("/required"), `den versionerede dækning '${c.id}' skal være obligatorisk`));
    if ((c.evidenceRefs ?? []).length === 0) problems.push(err(at("/evidenceRefs"), `dækningen '${c.id}' mangler evidens`));
    if (c.status === "passed") {
      for (const probeId of c.probeIds ?? []) {
        const probe = probesById.get(probeId);
        if (!probe) problems.push(err(at("/probeIds"), `dækningen '${c.id}' peger på den ukendte sonde '${probeId}'`));
        else if (probe.result !== "passed") problems.push(err(at("/status"), `dækningen '${c.id}' er 'passed', men sonden '${probeId}' er '${probe.result}'`));
      }
    }
    if (c.status === "covered-by-check") {
      for (const ref of c.evidenceRefs ?? []) {
        if (ref.startsWith("check:") && checkIds && !checkIds.has(ref.slice("check:".length))) {
          problems.push(err(at("/evidenceRefs"), `dækningen '${c.id}' peger på den ukendte check '${ref}'`));
        }
      }
    }
  }

  // Harnesskørsler: kun autoriserede mål, konsistent resumé og unikke sonder.
  const runIds = (assessment.harnessRuns ?? []).map((r) => r.id);
  if (new Set(runIds).size !== runIds.length) problems.push(err("/harnessRuns", "kørsels-id'er skal være unikke"));
  const seenProbes = new Set();
  for (const [i, run] of (assessment.harnessRuns ?? []).entries()) {
    const at = (suffix) => `/harnessRuns/${i}${suffix}`;
    if (run.authorized !== true) problems.push(err(at("/authorized"), "en kørsel mod et uautoriseret mål må ikke indgå"));
    for (const p of run.probes ?? []) {
      if (seenProbes.has(p.id)) problems.push(err(at("/probes"), `sonden '${p.id}' optræder mere end én gang`));
      seenProbes.add(p.id);
    }
    const passed = (run.probes ?? []).filter((p) => p.result === "passed").length;
    const failed = (run.probes ?? []).filter((p) => p.result === "failed").length;
    if (run.summary?.total !== (run.probes ?? []).length || run.summary?.passed !== passed || run.summary?.failed !== failed) {
      problems.push(err(at("/summary"), `kørslen '${run.id}' har et inkonsistent resumé`));
    }
    if (roe) {
      const target = (roe.targets ?? []).find((t) => t.id === run.targetId);
      if (!target) problems.push(err(at("/targetId"), `kørslen peger på det ukendte mål '${run.targetId}'`));
      else if (target.authorized !== true) problems.push(err(at("/authorized"), `kørslen bruger det uautoriserede mål '${run.targetId}'`));
    }
  }

  // Fund og retest.
  const findingIds = (assessment.findings ?? []).map((f) => f.id);
  if (new Set(findingIds).size !== findingIds.length) problems.push(err("/findings", "fund-id'er skal være unikke"));
  const findingById = new Map((assessment.findings ?? []).map((f) => [f.id, f]));
  for (const [i, finding] of (assessment.findings ?? []).entries()) {
    const at = (suffix) => `/findings/${i}${suffix}`;
    if (finding.reproducible !== true) problems.push(err(at("/reproducible"), `fundet '${finding.id}' skal være reproducerbart`));
    if (finding.status === "fixed" && !(assessment.retests ?? []).some((r) => r.findingId === finding.id && r.result === "passed" && r.fixedArtifactDigest === finding.affectedArtifactDigest)) {
      problems.push(err(at("/status"), `fundet '${finding.id}' er 'fixed' uden et bestået retest af det rettede artefakt`));
    }
    if (finding.status === "accepted") {
      const exception = finding.exception;
      if (!exception || !isNamedHuman(exception.acceptedBy)) problems.push(err(at("/exception"), `fundet '${finding.id}' er accepteret uden en navngivet menneskelig undtagelse`));
      else {
        const expires = Date.parse(exception.expiresAt ?? "");
        if (!Number.isFinite(expires) || expires <= now) problems.push(err(at("/exception/expiresAt"), `undtagelsen for '${finding.id}' er udløbet`));
        if ((exception.compensatingControls ?? []).length === 0) problems.push(err(at("/exception/compensatingControls"), `undtagelsen for '${finding.id}' mangler kompenserende kontroller`));
      }
    }
    if (openSeverities.includes(finding.severity) && !["fixed", "false-positive", "accepted"].includes(finding.status)) {
      problems.push(err(at("/status"), `fundet '${finding.id}' (${finding.severity}) er stadig '${finding.status}'`));
    }
  }
  const retestIds = (assessment.retests ?? []).map((r) => r.id);
  if (new Set(retestIds).size !== retestIds.length) problems.push(err("/retests", "retest-id'er skal være unikke"));
  for (const [i, retest] of (assessment.retests ?? []).entries()) {
    const at = (suffix) => `/retests/${i}${suffix}`;
    const finding = findingById.get(retest.findingId);
    if (!finding) problems.push(err(at("/findingId"), `retest peger på det ukendte fund '${retest.findingId}'`));
    else if (finding.remediation?.owner && personsEqual(finding.remediation.owner, retest.performedBy)) {
      problems.push(err(at("/performedBy"), `retest af '${retest.findingId}' må ikke udføres af den der ejer afhjælpningen`));
    }
  }

  // Uafhængig vurdering.
  const independent = assessment.independentAssessment;
  if (independent) {
    if (!isNamedHuman(independent.assessor)) problems.push(err("/independentAssessment/assessor", "en uafhængig vurdering skal være udført af et navngivet menneske"));
    if (independent.assessor?.subject && independent.assessor.subject === producerSubject) {
      problems.push(err("/independentAssessment/assessor", "implementøren kan ikke levere den uafhængige vurdering"));
    }
    const performed = Date.parse(independent.performedAt ?? "");
    const expires = Date.parse(independent.expiresAt ?? "");
    if (!Number.isFinite(performed) || !Number.isFinite(expires) || expires <= performed) problems.push(err("/independentAssessment", "den uafhængige vurdering mangler et gyldigt tidsinterval"));
    else if (expires <= now) problems.push(err("/independentAssessment/expiresAt", "den uafhængige vurdering er udløbet"));
    if (independent.targetCommit && independent.targetCommit !== binding.targetCommit) problems.push(err("/independentAssessment/targetCommit", "vurderingen er bundet til et andet commit end vurderingsregisteret"));
  }

  // Releasebeslutning.
  if (assessment.releaseDecision) {
    if (!isNamedHuman(assessment.releaseDecision.decidedBy)) problems.push(err("/releaseDecision/decidedBy", "releasebeslutningen skal træffes af et navngivet menneske"));
    if (assessment.releaseDecision.decision === "approved" && !independent) problems.push(err("/releaseDecision", "en godkendt releasebeslutning kræver en uafhængig vurdering"));
  }

  // Status-konsistens.
  const failedCoverage = (assessment.coverage ?? []).filter((c) => c.status === "failed");
  const blockingFindings = (assessment.findings ?? []).filter((f) => openSeverities.includes(f.severity) && !["fixed", "false-positive", "accepted"].includes(f.status));
  const incomplete = (assessment.coverage ?? []).some((c) => c.status !== "passed" && c.status !== "covered-by-check");
  if (assessment.status === "complete") {
    if (failedCoverage.length || blockingFindings.length || incomplete) problems.push(err("/status", "status 'complete' kræver fuld bestået dækning og ingen blokerende fund"));
    if (!independent || assessment.releaseDecision?.decision !== "approved") problems.push(err("/status", "status 'complete' kræver en uafhængig vurdering og en godkendt releasebeslutning"));
  }
  if (assessment.status === "failed" && failedCoverage.length === 0 && blockingFindings.length === 0) {
    problems.push(err("/status", "status 'failed' kræver mindst én fejlet dækning eller et blokerende fund"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Produktionsgate                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Evaluer produktionsgaten. Gaten muterer intet og svarer på ét spørgsmål:
 * kan denne artefaktversion bære en første kundeproduktionsrelease?
 */
export function evaluateAssessmentGate({ assessment = null, roe = null, now = Date.now(), expectedCommit = null, expectedArtifactDigest = null, producerSubject = PRODUCER.subject, openSeverities = OPEN_SEVERITIES, coverageAllowed = ["passed", "covered-by-check"] } = {}) {
  const blockers = [];
  if (!assessment) {
    return { schemaVersion: 1, kind: "SecurityAssessmentGateResult", generatedAt: new Date(now).toISOString(), targetCommit: expectedCommit, artifactDigest: expectedArtifactDigest, decision: "blocked", outstanding: true, producer: { type: "implementer", name: "security-assessment-gate", subject: producerSubject }, blockers: [{ id: "missing-assessment", reason: "der findes ingen sikkerhedsvurdering" }], coverage: { total: 0, passed: 0, failed: 0, notRun: 0 }, findings: { total: 0, open: 0, blocking: 0 } };
  }
  for (const problem of rulesOfEngagementProblems(roe, { now })) blockers.push({ id: "roe-invalid", reason: `${problem.path} ${problem.message}`.trim() });

  const binding = assessment.artifactBinding ?? {};
  if (expectedCommit && binding.targetCommit !== expectedCommit) blockers.push({ id: "changed-commit", reason: `vurderingen dækker commit ${binding.targetCommit}, målet er ${expectedCommit}` });
  if (expectedArtifactDigest && binding.artifactDigest !== expectedArtifactDigest) blockers.push({ id: "changed-artifact", reason: "vurderingen dækker et andet artefakt end den version der skal frigives" });

  const coverage = assessment.coverage ?? [];
  const coverageIds = new Set(coverage.map((c) => c.id));
  for (const id of COVERAGE_IDS) {
    if (!coverageIds.has(id)) blockers.push({ id: `coverage:${id}`, reason: `dækningskategorien '${id}' mangler` });
  }
  for (const c of coverage) {
    if (c.required !== false && !coverageAllowed.includes(c.status)) blockers.push({ id: `coverage:${c.id}`, reason: `dækningen '${c.id}' er '${c.status}'` });
  }

  const findings = assessment.findings ?? [];
  for (const finding of findings) {
    const status = effectiveFindingStatus(finding, { now });
    if (openSeverities.includes(finding.severity) && !["fixed", "false-positive", "accepted"].includes(status)) {
      blockers.push({ id: `finding:${finding.id}`, reason: `fundet '${finding.id}' (${finding.severity}) er '${status}'` });
    }
  }

  const independent = assessment.independentAssessment;
  if (!independent) {
    blockers.push({ id: "no-independent-assessment", reason: "der findes ingen uafhængig vurdering; en implementørkørsel tæller ikke" });
  } else {
    if (!isNamedHuman(independent.assessor)) blockers.push({ id: "invalid-independent-assessment", reason: "assessoren er ikke et navngivet menneske" });
    if (independent.assessor?.subject === producerSubject) blockers.push({ id: "invalid-independent-assessment", reason: "implementøren kan ikke være den uafhængige assessor" });
    const performed = Date.parse(independent.performedAt ?? "");
    const expires = Date.parse(independent.expiresAt ?? "");
    if (!Number.isFinite(performed) || !Number.isFinite(expires) || performed > now || expires <= now) blockers.push({ id: "invalid-independent-assessment", reason: "den uafhængige vurdering er udløbet eller mangler et gyldigt tidsinterval" });
    if (expectedCommit && independent.targetCommit !== expectedCommit) blockers.push({ id: "invalid-independent-assessment", reason: "den uafhængige vurdering er bundet til et andet commit" });
    if (expectedArtifactDigest && independent.artifactDigest !== expectedArtifactDigest) {
      const review = assessment.impactReview;
      const covered = review && review.fromArtifactDigest === independent.artifactDigest && review.toArtifactDigest === expectedArtifactDigest && isNamedHuman(review.reviewedBy);
      if (!covered) blockers.push({ id: "assessment-artifact-changed", reason: "artefaktet er ændret efter den uafhængige vurdering uden en impact review" });
    }
  }

  const decision = assessment.releaseDecision;
  if (!decision) blockers.push({ id: "no-release-decision", reason: "der mangler en navngivet menneskelig releasebeslutning" });
  else {
    if (!isNamedHuman(decision.decidedBy)) blockers.push({ id: "invalid-release-decision", reason: "releasebeslutningen er ikke truffet af et navngivet menneske" });
    if (decision.decision !== "approved") blockers.push({ id: `release-decision:${decision.decision}`, reason: `releasebeslutningen er '${decision.decision}'` });
  }

  for (const problem of securityAssessmentProblems(assessment, { now, roe, expectedCommit, expectedArtifactDigest, producerSubject, openSeverities })) {
    blockers.push({ id: "assessment-invalid", reason: `${problem.path} ${problem.message}`.trim() });
  }
  if (assessment.status !== "complete") blockers.push({ id: "assessment-outstanding", reason: `vurderingens status er '${assessment.status}'` });

  const outstanding = blockers.some((b) => ["no-independent-assessment", "assessment-outstanding", "no-release-decision", "changed-artifact", "changed-commit", "assessment-artifact-changed"].includes(b.id) || b.id.startsWith("coverage:"));

  return {
    schemaVersion: 1,
    kind: "SecurityAssessmentGateResult",
    generatedAt: new Date(now).toISOString(),
    targetCommit: expectedCommit ?? binding.targetCommit ?? null,
    artifactDigest: expectedArtifactDigest ?? binding.artifactDigest ?? null,
    decision: blockers.length === 0 ? "eligible" : "blocked",
    outstanding,
    producer: { type: "implementer", name: "security-assessment-gate", subject: producerSubject },
    blockers,
    coverage: {
      total: coverage.length,
      passed: coverage.filter((c) => c.status === "passed" || c.status === "covered-by-check").length,
      failed: coverage.filter((c) => c.status === "failed").length,
      notRun: coverage.filter((c) => c.status === "not-run").length,
    },
    findings: {
      total: findings.length,
      open: findings.filter((f) => !["fixed", "false-positive"].includes(effectiveFindingStatus(f, { now }))).length,
      blocking: findings.filter((f) => openSeverities.includes(f.severity) && !["fixed", "false-positive", "accepted"].includes(effectiveFindingStatus(f, { now }))).length,
    },
  };
}

export function gateResultProblems(gate) {
  const problems = [];
  if (!gate) return [err("/", "gate-resultatet mangler")];
  const blockers = gate.blockers ?? [];
  if (gate.decision === "eligible" && blockers.length > 0) problems.push(err("/decision", "en 'eligible' beslutning kan ikke have blokkere"));
  if (gate.decision === "blocked" && blockers.length === 0) problems.push(err("/decision", "en 'blocked' beslutning skal have mindst én blokker"));
  const coverage = gate.coverage ?? {};
  if (coverage.passed + coverage.failed + coverage.notRun !== coverage.total) problems.push(err("/coverage", "dækningstallene summer ikke"));
  return problems;
}
