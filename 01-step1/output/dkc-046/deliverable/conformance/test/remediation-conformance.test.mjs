/**
 * DKC-046 — konformanstest for begrænset selvreparation.
 *
 * Efterprøver de seks acceptkriterier på validatorniveau og mod den rigtige
 * remediation-orkestrator via validate-schemas/remediation-check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, buildAjv, SCHEMA_IDS } from "../src/schemas.mjs";
import {
  remediationPlanProblems,
  resourceLeaseProblems,
  healthObservationProblems,
  validateRemediationPlan,
  validateResourceLease,
  validateHealthObservation,
  knownRemediationRunbooks,
} from "../src/remediation.mjs";
import { validateRunbook } from "../src/runbook.mjs";
import { verifyRunbookSignature, runbookDigest, runbookRef } from "../../approvals/src/runbook.mjs";

const NOW = Date.parse("2025-09-02T00:00:00Z");
const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const plan = read("contracts/examples/remediation-plan.example.json");
const lease = read("contracts/examples/resource-lease.example.json");
const health = read("contracts/examples/health-observation.example.json");
const keyring = read("runbooks/dev-keyring.json");
const clone = (x) => JSON.parse(JSON.stringify(x));

test("remediation-plan-eksemplet validerer (skema + semantik)", () => {
  const { ajv } = buildAjv();
  const result = validateRemediationPlan(plan, ajv, { runbooks: knownRemediationRunbooks(repoRoot) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("resource-lease-eksemplet validerer (skema + semantik)", () => {
  const { ajv } = buildAjv();
  const result = validateResourceLease(lease, ajv);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("health-observation-eksemplet validerer (skema + semantik)", () => {
  const { ajv } = buildAjv();
  const result = validateHealthObservation(health, ajv);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("en ulovlig tilstandsovergang afvises", () => {
  const broken = clone(plan);
  broken.states = [{ state: "detected", at: "2025-09-02T08:00:00Z" }, { state: "executing", at: "2025-09-02T08:00:01Z" }];
  broken.outcome = { state: "executing", reason: null };
  const problems = remediationPlanProblems(broken);
  assert.ok(problems.some((p) => /ulovlig overgang/.test(p.message)));
});

test("en irreversibel handling må ikke beskrives som reversibel", () => {
  const broken = clone(plan);
  broken.reversibility = { verb: "migrate", reversible: true, classification: "reversible-write", compensation: "rollback", fallback: "compensation" };
  const problems = remediationPlanProblems(broken);
  assert.ok(problems.some((p) => /irreversibel/.test(p.message)));
  assert.ok(problems.some((p) => /stop-and-escalate/.test(p.message)));
});

test("en usikker fallback-handling afvises", () => {
  const broken = clone(plan);
  broken.fallback = { actions: ["drop-database"], authorizedBy: { subject: "oidc|anna.andersen" }, ran: [] };
  const problems = remediationPlanProblems(broken);
  assert.ok(problems.some((p) => /sikker fallback/.test(p.message)));
});

test("rolle-sammenblanding afvises", () => {
  const broken = clone(plan);
  broken.roles.executor = { ...broken.roles.planner };
  const problems = remediationPlanProblems(broken);
  assert.ok(problems.some((p) => /samme identitet/.test(p.message)));
});

test("en ukendt runbook uden særskilt evidens afvises", () => {
  const broken = clone(plan);
  broken.runbook = { ref: "unknown@9.9.9", digest: "a".repeat(64) };
  const problems = remediationPlanProblems(broken);
  assert.ok(problems.some((p) => /særskilt evidens/.test(p.message)));
});

test("en lease med cooldown før udløb afvises", () => {
  const broken = clone(lease);
  broken.cooldownUntil = "2025-09-02T08:00:00Z";
  broken.expiresAt = "2025-09-02T08:15:00Z";
  const problems = resourceLeaseProblems(broken);
  assert.ok(problems.some((p) => /cooldown/.test(p.message)));
});

test("en degraderet health-observation uden begrundelse afvises", () => {
  const broken = clone(health);
  broken.readings = [0.99, 0.4];
  broken.degraded = true;
  broken.healthy = false;
  broken.reason = null;
  const problems = healthObservationProblems(broken);
  assert.ok(problems.some((p) => /begrundelse/.test(p.message)));
});

test("de to selvreparations-runbooks er signerede og dækker verberne", () => {
  for (const file of ["runbooks/stateless-restart.runbook.json", "runbooks/bounded-scale.runbook.json"]) {
    const rb = read(file);
    assert.equal(verifyRunbookSignature(rb, keyring).ok, true, file);
    const { ajv } = buildAjv();
    const result = validateRunbook(rb, ajv, { now: NOW, keyring });
    assert.equal(result.ok, true, `${file}: ${JSON.stringify(result.errors)}`);
    assert.ok(rb.approval.flow === "standard" && rb.approval.preApproved === true);
  }
});

test("runbook-katalogets digests matcher de faktiske runbooks", () => {
  const registry = read("runbooks/registry.json");
  for (const entry of registry.runbooks) {
    const rb = read(entry.contract);
    assert.equal(runbookRef(rb), entry.ref, entry.contract);
    assert.equal(runbookDigest(rb), entry.digest, entry.contract);
  }
});

test("SCHEMA_IDS indeholder remediation-kontrakterne", () => {
  assert.ok(SCHEMA_IDS.remediationPlan);
  assert.ok(SCHEMA_IDS.resourceLease);
  assert.ok(SCHEMA_IDS.healthObservation);
});
