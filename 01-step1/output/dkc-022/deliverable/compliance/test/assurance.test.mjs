import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssuranceRegister, loadDataRegister, loadControlIds, assembleEvidencePackage, renderAssuranceDoc, loadEvidenceRecordMap } from "../src/assurance.mjs";
import { assuranceRegisterProblems, pilotBlockers, assurancePackageProblems, validateAssuranceRegister, validateEvidencePackage } from "../../conformance/src/assurance.mjs";
import { sealRecord, recordDigest } from "../../conformance/src/evidence-mode.mjs";
import { runBreachExercise, breachExerciseProblems } from "../src/incident-drill.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function clone() {
  return structuredClone(loadAssuranceRegister(repoRoot));
}

test("det kanoniske register validerer med skema og beslutningssemantik", () => {
  const register = loadAssuranceRegister(repoRoot);
  assert.deepEqual(assuranceRegisterProblems(register, { dataRegister: loadDataRegister(repoRoot), controlIds: loadControlIds(repoRoot) }), []);
  const result = validateAssuranceRegister(register);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("eksemplet er identisk med det kanoniske register", () => {
  const example = JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "assurance-register.example.json"), "utf8"));
  assert.deepEqual(example, loadAssuranceRegister(repoRoot));
});

test("hver åben beslutning skal have en ansvarlig person", () => {
  const register = clone();
  delete register.decisions[0].responsible;
  const problems = assuranceRegisterProblems(register);
  assert.ok(problems.some((p) => p.path === "/decisions/0/responsible"));
});

test("en åben beslutning må ikke have en ejerbeslutning og skal blokere pilot", () => {
  const register = clone();
  register.decisions[0].ownerDecision = { subject: "oidc|x", name: "X Y", role: "Role", date: "2026-09-24", decisionRef: "docs/x.md" };
  register.decisions[0].blocksPersonalDataPilot = false;
  const problems = assuranceRegisterProblems(register);
  assert.ok(problems.some((p) => p.path === "/decisions/0/ownerDecision"));
  assert.ok(problems.some((p) => p.path === "/decisions/0/blocksPersonalDataPilot"));
});

test("en udestående DPIA-screening skal markeres som blokerende", () => {
  const register = clone();
  register.dataProtection.dpiaScreenings[0].pendingBlocker = false;
  assert.ok(assuranceRegisterProblems(register).some((p) => p.path === "/dataProtection/dpiaScreenings/0/pendingBlocker"));
});

test("registeret må ikke hævde en certificering", () => {
  const register = clone();
  register.metadata.certificationClaim = true;
  assert.ok(assuranceRegisterProblems(register).some((p) => p.path === "/metadata/certificationClaim"));
});

test("et krav uden evidens skal markeres 'missing-evidence'", () => {
  const register = clone();
  register.requirements[0].evidenceRefs = [];
  register.requirements[0].status = "verified";
  assert.ok(assuranceRegisterProblems(register).some((p) => p.path === "/requirements/0/evidenceRefs"));
});

test("en åben høj risiko skal blokere persondatapilot", () => {
  const register = clone();
  register.risks[0].blocksPersonalDataPilot = false;
  assert.ok(assuranceRegisterProblems(register).some((p) => /RISK|risiko/.test(p.message) && p.path === "/risks/0"));
});

test("persondatapilot er blokeret ved uafklarede væsentlige risici", () => {
  const blockers = pilotBlockers(loadAssuranceRegister(repoRoot));
  assert.ok(blockers.some((b) => b.kind === "dpia"));
  assert.ok(blockers.some((b) => b.kind === "decision"));
  assert.ok(blockers.some((b) => b.kind === "risk"));
  assert.ok(blockers.length >= 3);
});

test("den genererede dokumentation gengiver krav, risici og blokere", () => {
  const doc = renderAssuranceDoc(loadAssuranceRegister(repoRoot));
  assert.match(doc, /Evidens- og risikoregister/);
  assert.match(doc, /REQ-GDPR-001/);
  assert.match(doc, /DEC-001/);
  assert.match(doc, /Blokere for en pilot med persondata/);
  assert.match(doc, /certificering:\*\* nej/i);
});

/* -------------------------------------------------------------------------- */
/* Evidenspakken                                                              */
/* -------------------------------------------------------------------------- */

function syntheticRecord(overrides = {}) {
  const record = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EvidenceRecord",
    id: overrides.id ?? "synthetic-record",
    subject: { kind: "check", name: "synthetic" },
    mode: overrides.mode ?? "contract",
    result: overrides.result ?? "pass",
    commit: overrides.commit ?? "83ad91a963d8055f77c29fb4361455689df95acb",
    imageDigest: null,
    environment: overrides.environment ?? "local",
    upstreamVersion: "platform@1.0.0",
    runId: "test-run",
    capturedAt: overrides.capturedAt ?? "2026-09-24T10:00:00Z",
    expiresAt: overrides.expiresAt ?? "2026-10-24T10:00:00Z",
    producer: { type: "ci", name: "test", subject: "ci|test" },
    command: ["make", "test"],
    artifact: { uri: "artifact.json", sha256: "a".repeat(64) },
  };
  const sealed = sealRecord({ ...record, ...overrides });
  return sealed;
}

test("en komplet pakke skelner automatiseret evidens, menneskebeslutninger og manglende vurderinger", () => {
  const register = loadAssuranceRegister(repoRoot);
  const records = loadEvidenceRecordMap(join(repoRoot, "evidence", "records"));
  const pkg = assembleEvidencePackage({ register, evidenceRecords: records, now: Date.parse("2026-09-24T10:05:00Z"), registerCommit: "83ad91a963d8055f77c29fb4361455689df95acb", generatedAt: "2026-09-24T10:05:00Z" });
  assert.equal(pkg.badge, "fixture-only");
  assert.equal(pkg.productionReady, false);
  assert.equal(pkg.complianceStatus, "not-certified");
  assert.equal(pkg.notACertification, true);
  assert.equal(pkg.acceptedBy, null);
  assert.ok(pkg.humanDecisions.some((d) => d.decidedBy?.name === "Anna Andersen"));
  assert.ok(pkg.missingAssessments.some((m) => m.kind === "dpia"));
  assert.ok(pkg.pilotBlockers.length >= 3);
  assert.equal(validateEvidencePackage(pkg).ok, true, JSON.stringify(validateEvidencePackage(pkg).errors));
});

test("en ufuldstændig pakke bliver 'missing' og kan ikke være productionReady", () => {
  const register = clone();
  const pkg = assembleEvidencePackage({ register, evidenceRecords: [], now: Date.parse("2026-09-24T10:05:00Z"), generatedAt: "2026-09-24T10:05:00Z" });
  assert.equal(pkg.badge, "missing");
  assert.equal(pkg.productionReady, false);
  assert.ok(pkg.summary.missing >= register.requirements.length);
  assert.ok(pkg.requirements.every((r) => r.coverage.every((c) => c.status === "missing")));
});

test("udløbet evidens afvises og vises som afvist", () => {
  const register = clone();
  const expired = syntheticRecord({ id: register.requirements[0].evidenceRefs[0], mode: "integration", environment: "staging", expiresAt: "2000-01-01T00:00:00Z" });
  const pkg = assembleEvidencePackage({ register, evidenceRecords: [expired], now: Date.parse("2026-09-24T10:05:00Z"), generatedAt: "2026-09-24T10:05:00Z" });
  assert.ok(pkg.rejectedEvidence.some((r) => r.status === "expired"));
  assert.equal(pkg.productionReady, false);
});

test("evidens bundet til det forkerte commit afvises", () => {
  const register = clone();
  const wrong = syntheticRecord({ id: register.requirements[0].evidenceRefs[0], mode: "runtime", environment: "prod", commit: "f".repeat(40) });
  const pkg = assembleEvidencePackage({ register, evidenceRecords: [wrong], expected: { commit: "83ad91a963d8055f77c29fb4361455689df95acb" }, now: Date.parse("2026-09-24T10:05:00Z"), generatedAt: "2026-09-24T10:05:00Z" });
  assert.ok(pkg.rejectedEvidence.some((r) => r.status === "wrong-artifact"));
});

test("en manuelt ændret evidenspost afvises som tampered", () => {
  const register = clone();
  const tampered = syntheticRecord({ id: register.requirements[0].evidenceRefs[0], mode: "integration", environment: "staging" });
  tampered.upstreamVersion = "manipuleret@9.9.9";
  // digest bevares, så ændringen opdages
  const pkg = assembleEvidencePackage({ register, evidenceRecords: [tampered], now: Date.parse("2026-09-24T10:05:00Z"), generatedAt: "2026-09-24T10:05:00Z" });
  assert.ok(pkg.rejectedEvidence.some((r) => r.status === "tampered"));
  assert.notEqual(recordDigest(tampered), tampered.digest);
});

test("en pakke med blokere kan ikke være productionReady", () => {
  const base = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EvidencePackage",
    packageId: "pkg-1",
    generatedAt: "2026-09-24T10:05:00Z",
    registerVersion: "1.0.0",
    registerCommit: null,
    notACertification: true,
    complianceStatus: "not-certified",
    productionReady: true,
    badge: "production",
    acceptedBy: null,
    acceptedAt: null,
    requirements: [],
    humanDecisions: [],
    missingAssessments: [],
    rejectedEvidence: [],
    pilotBlockers: [{ kind: "risk", id: "RISK-1", reason: "åben risiko" }],
    summary: { requirements: 0, verified: 0, missing: 0, humanDecisions: 0, rejectedEvidence: 0, pilotBlockers: 1 },
  };
  const problems = assurancePackageProblems(base);
  assert.ok(problems.some((p) => p.path === "/pilotBlockers"));
});

test("en pakke må ikke erklære compliance", () => {
  const register = loadAssuranceRegister(repoRoot);
  const pkg = assembleEvidencePackage({ register, evidenceRecords: [], now: Date.parse("2026-09-24T10:05:00Z"), generatedAt: "2026-09-24T10:05:00Z" });
  pkg.complianceStatus = "compliant";
  assert.ok(assurancePackageProblems(pkg).some((p) => p.path === "/complianceStatus"));
});

/* -------------------------------------------------------------------------- */
/* Brudøvelse                                                                 */
/* -------------------------------------------------------------------------- */

function scenario(overrides = {}) {
  return {
    id: "breach-drill-1",
    detectedAt: "2026-09-24T10:00:00Z",
    severity: "high",
    personalDataAffected: true,
    decision: {
      notifyAuthority: true,
      notifyCustomers: true,
      rationale: "Persondatabærende hændelse anmeldes til myndighed og kunder.",
      decidedBy: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Security Owner" },
    },
    ...overrides,
  };
}

test("en brudøvelse dokumenterer beslutningen og beregner indberetningsfristerne", () => {
  const report = runBreachExercise({ register: loadAssuranceRegister(repoRoot), scenario: scenario(), now: Date.parse("2026-09-24T10:30:00Z") });
  assert.equal(report.documented, true);
  assert.equal(report.synthetic, true);
  assert.deepEqual(breachExerciseProblems(report), []);
  assert.ok(report.duties.some((d) => d.regime === "gdpr-art33" && d.deadlineAt === "2026-09-27T10:00:00.000Z"));
  assert.ok(report.duties.some((d) => d.regime === "nis2-art23" && d.deadlineAt === "2026-09-25T10:00:00.000Z"));
  assert.equal(report.decision.decidedBy.name, "Cecilia Christensen");
});

test("en brudøvelse uden persondata udelader GDPR-fristen", () => {
  const report = runBreachExercise({ register: loadAssuranceRegister(repoRoot), scenario: scenario({ personalDataAffected: false }) });
  assert.ok(!report.duties.some((d) => d.regime === "gdpr-art33"));
  assert.ok(report.duties.some((d) => d.regime === "nis2-art23"));
});

test("en brudøvelse kræver et navngivet menneske og en begrundelse", () => {
  assert.throws(() => runBreachExercise({ register: loadAssuranceRegister(repoRoot), scenario: scenario({ decision: { notifyAuthority: true, notifyCustomers: true, rationale: "x".repeat(30), decidedBy: { subject: "team|soc", name: "SOC", role: "Team" } } }) }), /navngivet menneske/);
  assert.throws(() => runBreachExercise({ register: loadAssuranceRegister(repoRoot), scenario: scenario({ decision: { notifyAuthority: true, notifyCustomers: true, rationale: "kort", decidedBy: { subject: "oidc|a.b", name: "A B", role: "R" } } }) }), /begrundelse/);
});

test("en manglende anmeldelse vises som 'not-notified'", () => {
  const report = runBreachExercise({ register: loadAssuranceRegister(repoRoot), scenario: scenario({ decision: { notifyAuthority: false, notifyCustomers: false, rationale: "Vurderet ikke anmeldelsespligtig efter intern gennemgang.", decidedBy: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" } } }) });
  assert.ok(report.duties.every((d) => d.status === "not-notified"));
  assert.deepEqual(breachExerciseProblems(report), []);
});
