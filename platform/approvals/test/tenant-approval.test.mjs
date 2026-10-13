import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApprovalService } from "../src/approval-service.mjs";

const example = JSON.parse(readFileSync(new URL("../../contracts/examples/approval-request.example.json", import.meta.url), "utf8"));
const clone = () => structuredClone(example);
const TRAINING = ["evidence-over-prose", "when-to-reject"];

function serviceWith() {
  const now = Date.parse("2025-09-02T00:00:00Z");
  return createApprovalService({ trainingRegistry: () => TRAINING, clock: () => now });
}

const human = (tenantId, id, extra = {}) => ({ kind: "human", id, tenantId, groups: ["platform-approvers"], ...extra });
const requester = human("acme", "oidc|requester");

test("en godkender fra en anden kunde kan ikke godkende uden scope", () => {
  const service = serviceWith();
  const req = service.create(clone(), { principal: requester });
  assert.throws(
    () => service.decide(req.id, { principal: human("globex", "oidc|outsider"), verdict: "approve" }),
    (err) => err.status === 403 && /kunden 'globex'/.test(err.message)
  );
  assert.equal(service.get(req.id, { principal: requester }).decision.approvals.length, 0);
});

test("platformrolle med eksplicit scope for kunden kan godkende", () => {
  const service = serviceWith();
  const req = service.create(clone(), { principal: requester });
  service.decide(req.id, { principal: human("globex", "oidc|platform.one", { roles: ["platform-admin:acme"] }), verdict: "approve" });
  service.decide(req.id, { principal: human("globex", "oidc|platform.two", { roles: ["platform-admin:acme"] }), verdict: "approve" });
  assert.equal(service.get(req.id, { principal: requester }).decision.state, "approved");
});

test("platformrolle med scope for den forkerte kunde afvises", () => {
  const service = serviceWith();
  const req = service.create(clone(), { principal: requester });
  assert.throws(
    () => service.decide(req.id, { principal: human("globex", "oidc|platform.other", { roles: ["platform-admin:globex"] }), verdict: "approve" }),
    (err) => err.status === 403
  );
});

test("en anmoder må ikke oprette en godkendelse for en anden kunde uden scope", () => {
  const service = serviceWith();
  const payload = clone();
  payload.tenantId = "globex";
  assert.throws(
    () => service.create(payload, { principal: human("acme", "oidc|requester") }),
    (err) => err.status === 403
  );
});

test("en anmoder med scopet platformrolle må oprette for kunden", () => {
  const service = serviceWith();
  const payload = clone();
  payload.tenantId = "globex";
  const req = service.create(payload, { principal: human("acme", "oidc|platform.requester", { roles: ["platform-admin:globex"] }) });
  assert.equal(req.tenantId, "globex");
});
