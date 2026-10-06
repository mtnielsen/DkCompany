import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, deriveFamilyStatus } from "../src/model.mjs";
import { evaluateFamilyGate, evaluatePaymentGate } from "../src/gate.mjs";
import { evaluateFamilyCandidates } from "../src/candidates.mjs";

const all = loadAll(repoRoot);

function familyGate(id) {
  const family = all.families.families.find((f) => f.id === id);
  const candidate = evaluateFamilyCandidates(repoRoot, family);
  return { family, gate: evaluateFamilyGate(family, all.requirements, all.interfaces, candidate), candidate };
}

test("betaling kræver en godkendt ekstern tjeneste og begrænsede scopes", () => {
  const payment = evaluatePaymentGate(all.interfaces);
  assert.equal(payment.externalServiceRequired, true);
  assert.equal(payment.approved, false);
  assert.equal(payment.gate, "pending");
  assert.ok(payment.deniedScopes.includes("bank:full-access"));
  assert.ok(payment.allowedScopes.every((s) => !/bank:full-access|cards:/.test(s)));
  assert.ok(payment.ok === false);
});

test("økonomi er ikke danskklar og afventer bogføring", () => {
  const { gate } = familyGate("finance");
  assert.equal(gate.danishReady, false);
  assert.ok(gate.pendingGates.some((g) => g.id === "accounting"));
  assert.equal(gate.payment.gate, "pending");
});

test("HR er ikke danskklar og afventer løn", () => {
  const { gate } = familyGate("hr");
  assert.equal(gate.danishReady, false);
  assert.ok(gate.pendingGates.some((g) => g.id === "payroll"));
});

test("tid har ingen blokerende gates, men er ikke danskklar uden en godkendt kandidat", () => {
  const { gate } = familyGate("time");
  assert.equal(gate.familyStatus, "registered");
  assert.equal(gate.pendingGates.length, 0);
  assert.equal(gate.danishReady, false);
  assert.equal(gate.candidateGate, "blocked");
});

test("en bekræftet gate og en godkendt kandidat giver danskklar", () => {
  const requirements = JSON.parse(JSON.stringify(all.requirements));
  for (const req of requirements.requirements) {
    req.status = "confirmed";
    req.reviewedBy = { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Service Owner" };
    req.reviewedAt = "2026-02-01T00:00:00Z";
    req.evidence = ["docs/localization/module-registration-report.md"];
  }
  const interfaces = JSON.parse(JSON.stringify(all.interfaces));
  interfaces.interfaces.find((i) => i.id === "payment-bank").approvedExternalServiceRef = "contract:payment-provider-agreement";
  const family = all.families.families.find((f) => f.id === "finance");
  const candidate = { selectedGateStatus: "approved" };
  const gate = evaluateFamilyGate(family, requirements, interfaces, candidate);
  assert.equal(gate.pendingGates.length, 0);
  assert.equal(gate.payment.approved, true);
  assert.equal(gate.danishReady, true);
  assert.equal(deriveFamilyStatus(family, requirements.requirements, interfaces.interfaces), "registered");
});
