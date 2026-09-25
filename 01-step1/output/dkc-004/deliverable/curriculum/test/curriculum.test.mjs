import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { criterionHolds, complete, loadCurriculum, trainingRegistryFromEvents } from "../src/curriculum.mjs";
import { runValidation, repoRoot } from "../src/cli.mjs";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";

const approvalExample = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/approval-request.example.json"), "utf8"));

test("curriculumet validerer, og afvisningsscenarierne holder", () => {
  const { ok, problems, curriculum, scenarios } = runValidation();
  assert.equal(ok, true, problems.join("\n"));
  assert.ok(scenarios.length >= 6, "forventer mindst seks scenarier");
  assert.ok(scenarios.filter((s) => s.scenario.mustReject).length >= 5, "forventer mindst fem must-reject-scenarier");
  assert.ok(curriculum.modules.some((m) => m.id === "kill-switch"));
  assert.ok(curriculum.modules.some((m) => m.id === "first-24-hours"));
});

test("påstande der ikke matcher evidensen er altid et afvisningsscenarie", () => {
  const { scenarios } = runValidation();
  const mismatch = scenarios.find((s) => !s.claims.ok);
  assert.ok(mismatch, "forventer et scenarie hvor påstande ikke matcher");
  assert.equal(mismatch.scenario.expectedVerdict, "reject");
});

test("criterionHolds dækker operatorerne", () => {
  assert.equal(criterionHolds(false, "eq", false), true);
  assert.equal(criterionHolds(99, "neq", 3), true);
  assert.equal(criterionHolds(1, "lt", 2), true);
  assert.equal(criterionHolds(2, "lte", 2), true);
  assert.equal(criterionHolds(3, "gt", 2), true);
  assert.equal(criterionHolds(2, "gte", 2), true);
});

test("gennemførelses-events er gyldige CloudEvents", () => {
  const curriculum = loadCurriculum(repoRoot);
  const events = complete({ subject: "oidc|anna.andersen", moduleIds: curriculum.modules.map((m) => m.id), at: "2025-09-01T12:00:00Z" });
  assert.equal(events.length, curriculum.modules.length);
  const { ajv } = buildAjv();
  for (const event of events) {
    const { ok, errors } = validate(ajv, SCHEMA_IDS.cloudEvent, event);
    assert.equal(ok, true, errors.map((e) => e.message).join("; "));
    assert.equal(event.type, "dk.platform.curriculum.module.completed");
    assert.equal(event.principal.kind, "human");
  }
});

test("approval-servicen håndhæver træningskravet fra 2.4", () => {
  const curriculum = loadCurriculum(repoRoot);
  const events = complete({
    subject: "oidc|anna.andersen",
    moduleIds: curriculum.modules.map((m) => m.id),
    at: "2025-09-01T12:00:00Z",
  });
  const registry = trainingRegistryFromEvents(events, { curriculumVersion: curriculum.metadata.version });
  const service = createApprovalService({ trainingRegistry: registry, clock: () => Date.parse("2025-09-02T00:00:00Z") });

  const withoutTraining = service.create({ ...structuredClone(approvalExample), id: "018f3c2a-1b2c-7def-8a01-111111111111" });
  assert.throws(
    () => service.decide(withoutTraining.id, { principal: { kind: "human", id: "oidc|uden.traening", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" }),
    (err) => err.status === 428
  );

  const withTraining = service.create({ ...structuredClone(approvalExample), id: "018f3c2a-1b2c-7def-8a01-222222222222" });
  const decided = service.decide(withTraining.id, { principal: { kind: "human", id: "oidc|anna.andersen", tenantId: "acme", groups: ["platform-approvers"] }, verdict: "approve" });
  assert.equal(decided.decision.approvals.at(-1).trainingVerified, true);
  assert.equal(decided.decision.state, "pending", "to godkendelser kræves stadig");
});
