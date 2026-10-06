import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlan } from "../src/plan.mjs";
import { authorizeBreakGlass } from "../src/break-glass.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const plan = loadPlan(repoRoot);
const now = () => new Date("2026-09-23T12:00:00.000Z");

const human = (subject) => ({ subject, kind: "human", role: "Platform Operator" });
const validRequest = {
  requester: human("oidc|anna.andersen"),
  approver: human("oidc|cecilia.christensen"),
  scope: ["restart-workload"],
  durationMinutes: 30,
  reason: "Staging-node hænger og skal genstartes under incident.",
};

test("en gyldig break-glass-anmodning godkendes med udløb", () => {
  const result = authorizeBreakGlass(validRequest, plan, { now });
  assert.equal(result.ok, true);
  assert.equal(result.grant.approvedBy, "oidc|cecilia.christensen");
  assert.equal(result.grant.expiresAt, "2026-09-23T12:30:00.000Z");
  assert.equal(result.grant.audit, true);
});

test("en agent kan ikke anmode om eller godkende break-glass", () => {
  const agentRequester = authorizeBreakGlass({ ...validRequest, requester: { subject: "agent:app-1", kind: "agent", role: "executor" } }, plan, { now });
  assert.equal(agentRequester.ok, false);
  const agentApprover = authorizeBreakGlass({ ...validRequest, approver: { subject: "agent:app-2", kind: "agent", role: "verifier" } }, plan, { now });
  assert.equal(agentApprover.ok, false);
});

test("selv-godkendelse afvises", () => {
  const result = authorizeBreakGlass({ ...validRequest, approver: validRequest.requester }, plan, { now });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /samme som rekvirenten/.test(r)));
});

test("scope og varighed håndhæves", () => {
  const outOfScope = authorizeBreakGlass({ ...validRequest, scope: ["delete-cluster"] }, plan, { now });
  assert.ok(outOfScope.reasons.some((r) => /ikke tilladt/.test(r)));
  const tooLong = authorizeBreakGlass({ ...validRequest, durationMinutes: 1000 }, plan, { now });
  assert.ok(tooLong.reasons.some((r) => /varigheden/.test(r)));
  const noReason = authorizeBreakGlass({ ...validRequest, reason: "" }, plan, { now });
  assert.ok(noReason.reasons.some((r) => /begrundelse/.test(r)));
});
