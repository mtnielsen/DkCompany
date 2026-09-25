/**
 * DKC-065 — test af den rene assessment-gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAssessmentGate, gateResultProblems, effectiveFindingStatus } from "../src/model.mjs";

const roe = {
  metadata: { name: "x", version: "1.0.0", description: "engagement", accountableHuman: { subject: "oidc|a.a", name: "A A", role: "Owner" } },
  classification: "confidential",
  preparationOnly: true,
  authorization: { approved: false, approvedBy: null, approvedAt: null, reference: null, statement: "kun lokalt" },
  targets: [{ id: "local-loopback", kind: "loopback", scope: "http://127.0.0.1:0", environment: "local", tenantRef: "acme", authorized: true, authorizationRef: "prep", syntheticOnly: true, dataClassification: "synthetic", artifactRefs: ["telemetry-api"] }],
  identities: [{ id: "impl", subject: "process|suite", name: "Suite", role: "implementer", kind: "implementer", authorized: true }],
  techniques: [{ id: "auth", category: "authentication", description: "probe", destructive: false, allowed: true }],
  window: { from: "2026-03-01T00:00:00Z", to: "2026-04-01T00:00:00Z", timezone: "UTC", status: "open" },
  exclusions: [{ id: "no-prod", description: "no prod", reason: "prep" }],
  rateLimits: { requestsPerSecond: 1, concurrency: 1, maxPayloadBytes: 4096, notes: "lav" },
  stopConditions: [{ id: "stop", condition: "mutation", action: "abort" }],
  emergencyContacts: [{ role: "Owner", name: "A A", subject: "oidc|a.a", channel: "phone" }],
  evidenceHandling: { classification: "confidential", accessControl: "owner only", redactionRequired: true, secretHandling: "redact", provenance: "bevar", retentionDays: 30, storageRef: "security-assessment/report/" },
};

const now = Date.parse("2026-03-01T00:00:00Z");

test("en manglende vurdering giver en blokeret, udestående gate", () => {
  const gate = evaluateAssessmentGate({ assessment: null, roe, now });
  assert.equal(gate.decision, "blocked");
  assert.equal(gate.outstanding, true);
  assert.ok(gate.blockers.some((b) => b.id === "missing-assessment"));
  assert.deepEqual(gateResultProblems(gate), []);
});

test("et udløbet fund genåbnes", () => {
  const finding = { status: "accepted", exception: { acceptedBy: { subject: "oidc|a.a", name: "A A", role: "Owner" }, expiresAt: "2026-02-01T00:00:00Z", compensatingControls: ["x"] } };
  assert.equal(effectiveFindingStatus(finding, { now }), "reopened");
  const future = { ...finding, exception: { ...finding.exception, expiresAt: "2026-06-01T00:00:00Z" } };
  assert.equal(effectiveFindingStatus(future, { now }), "accepted");
});

test("gate-resultatet må ikke være eligible med blokkere", () => {
  const problems = gateResultProblems({ decision: "eligible", blockers: [{ id: "x", reason: "y" }], coverage: { total: 1, passed: 0, failed: 0, notRun: 1 } });
  assert.ok(problems.length > 0);
});
