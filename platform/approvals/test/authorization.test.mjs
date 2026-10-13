import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApprovalService } from "../src/approval-service.mjs";

const example = JSON.parse(readFileSync(new URL("../../contracts/examples/approval-request.example.json", import.meta.url), "utf8"));
const humanA = (id, groups = ["platform-approvers"], extra = {}) => ({ kind: "human", id, tenantId: "acme", groups, ...extra });
const requester = humanA("oidc|requester", []);
const approverOne = humanA("oidc|approver-one");
const approverTwo = humanA("oidc|approver-two");
const tenantMember = humanA("oidc|tenant-member", []);
const tenantless = { kind: "human", id: "oidc|tenantless", groups: [] };
const tenantB = { kind: "human", id: "oidc|tenant-b", tenantId: "globex", groups: ["platform-approvers", "security-officer"] };
const scopedPlatform = { kind: "human", id: "oidc|platform-reviewer", groups: ["platform-approvers"], roles: ["platform-admin:acme"] };
const workload = { kind: "workload", id: example.agent.spiffeId, tenantId: "acme" };
const principals = new Map([["Bearer requester", requester], ["Bearer approver-one", approverOne], ["Bearer approver-two", approverTwo], ["Bearer tenant-member", tenantMember], ["Bearer tenant-b", tenantB], ["Bearer tenantless", tenantless], ["Bearer workload", workload], ["Bearer scoped-platform", scopedPlatform]]);

function fixture() {
  const audit = [];
  let now = Date.now();
  let internal;
  const service = createApprovalService({
    onTrustedCapability: (capability) => { internal = capability; },
    trainingRegistry: () => ["evidence-over-prose", "when-to-reject"],
    clock: () => now,
    authenticator: { authenticate: async (authorization) => {
      const principal = principals.get(authorization);
      if (!principal) { const err = new Error("unauthenticated"); err.status = 401; throw err; }
      return principal;
    } },
    ledger: { append: (entry) => { audit.push(entry); return entry; }, verifyChain: () => ({ ok: true }) },
  });
  return { service, internal, audit, setNow: (value) => { now = value; } };
}

async function withHttp(fn) {
  const f = fixture();
  const port = await f.service.listen(0);
  const base = `http://127.0.0.1:${port}/v1/approvals`;
  try { await fn({ ...f, base }); } finally { await f.service.close(); }
}

function payload(id = "s103-http-request") {
  const value = structuredClone(example);
  value.id = id;
  return value;
}

test("HTTP list requires authentication, filters by tenant, and scopes every read route", async () => {
  await withHttp(async ({ service, base }) => {
    const created = await fetch(base, { method: "POST", headers: { authorization: "Bearer requester", "content-type": "application/json" }, body: JSON.stringify(payload()) });
    assert.equal(created.status, 201);

    const anonymous = await fetch(base);
    assert.equal(anonymous.status, 401);
    assert.doesNotMatch(await anonymous.text(), /s103-http-request/);
    const missingTenant = await fetch(`${base}/s103-http-request`, { headers: { authorization: "Bearer tenantless" } });
    assert.equal(missingTenant.status, 403);
    assert.doesNotMatch(await missingTenant.text(), /s103-http-request/);

    const ownList = await fetch(base, { headers: { authorization: "Bearer requester" } });
    assert.equal(ownList.status, 200);
    assert.deepEqual((await ownList.json()).requests.map((r) => r.id), ["s103-http-request"]);

    const scopedList = await fetch(`${base}?tenantId=acme`, { headers: { authorization: "Bearer scoped-platform" } });
    assert.equal(scopedList.status, 200);
    assert.deepEqual((await scopedList.json()).requests.map((r) => r.id), ["s103-http-request"]);
    const ignoredWrongTenant = await fetch(`${base}?tenantId=acme`, { headers: { authorization: "Bearer tenant-b" } });
    assert.equal(ignoredWrongTenant.status, 403);

    for (const path of ["/s103-http-request", "/s103-http-request/view", "/s103-http-request/merge-check"]) {
      const res = await fetch(`${base}${path}`, { headers: { authorization: "Bearer tenant-b" } });
      assert.equal(res.status, 403, path);
      assert.doesNotMatch(await res.text(), /s103-http-request/);
    }
    assert.equal(service.get("s103-http-request", { principal: requester }).decision.state, "pending");
  });
});

test("HTTP allows authorized human decisions and explicit tenant-scoped platform access", async () => {
  await withHttp(async ({ service, base }) => {
    const created = await fetch(base, { method: "POST", headers: { authorization: "Bearer requester", "content-type": "application/json" }, body: JSON.stringify(payload("s103-legitimate")) });
    assert.equal(created.status, 201);
    const scopedRead = await fetch(`${base}/s103-legitimate`, { headers: { authorization: "Bearer scoped-platform" } });
    assert.equal(scopedRead.status, 200);

    for (const token of ["Bearer approver-one", "Bearer approver-two"]) {
      const res = await fetch(`${base}/s103-legitimate/decisions`, { method: "POST", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ verdict: "approve" }) });
      assert.equal(res.status, 200);
      if (token === "Bearer approver-one") {
        const duplicate = await fetch(`${base}/s103-legitimate/decisions`, { method: "POST", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ verdict: "approve" }) });
        assert.equal(duplicate.status, 409);
      }
    }
    assert.equal(service.get("s103-legitimate", { principal: requester }).decision.state, "approved");
  });
});

test("HTTP identity, groups, training, and actor kind come only from authentication", async () => {
  await withHttp(async ({ service, base }) => {
    const created = await fetch(base, { method: "POST", headers: { authorization: "Bearer requester", "content-type": "application/json" }, body: JSON.stringify(payload("s103-identity-claims")) });
    assert.equal(created.status, 201);
    const spoofedHuman = await fetch(`${base}/s103-identity-claims/decisions`, { method: "POST", headers: { authorization: "Bearer tenant-member", "content-type": "application/json" }, body: JSON.stringify({ verdict: "approve", principal: approverOne, groups: ["platform-approvers"], roles: ["platform-admin:*"], completedTrainingModules: ["evidence-over-prose", "when-to-reject"] }) });
    assert.equal(spoofedHuman.status, 403);
    const workloadAsHuman = await fetch(`${base}/s103-identity-claims/decisions`, { method: "POST", headers: { authorization: "Bearer workload", "content-type": "application/json" }, body: JSON.stringify({ verdict: "approve", principal: approverOne, groups: ["platform-approvers"] }) });
    assert.equal(workloadAsHuman.status, 403);
    assert.equal(service.get("s103-identity-claims", { principal: requester }).decision.approvals.length, 0);
  });
});

test("HTTP cross-tenant decide and revoke deny without changing pending state and append denial audit", async () => {
  await withHttp(async ({ service, internal, base, audit }) => {
    const created = await fetch(base, { method: "POST", headers: { authorization: "Bearer requester", "content-type": "application/json" }, body: JSON.stringify(payload()) });
    assert.equal(created.status, 201);
    const id = "s103-http-request";

    const decide = await fetch(`${base}/${id}/decisions`, { method: "POST", headers: { authorization: "Bearer tenant-b", "content-type": "application/json" }, body: JSON.stringify({ verdict: "approve", principal: approverOne, groups: ["platform-approvers"], completedTrainingModules: ["evidence-over-prose", "when-to-reject"] }) });
    assert.equal(decide.status, 403);
    const revoke = await fetch(`${base}/${id}/revoke`, { method: "POST", headers: { authorization: "Bearer tenant-b", "content-type": "application/json" }, body: JSON.stringify({ reason: "cross tenant", principal: { ...tenantB, roles: ["security-officer"] } }) });
    assert.equal(revoke.status, 403);
    assert.equal(service.get(id, { principal: requester }).decision.state, "pending");
    assert.ok(audit.filter((e) => e.type === "approval.access_denied").length >= 2);
    assert.equal(internal.store.get(id).decision.state, "pending");
  });
});

test("HTTP authorization binds the workload identity and ignores body identity claims", async () => {
  await withHttp(async ({ service, base }) => {
    const clientPayload = payload("s103-workload-binding");
    clientPayload.decision.requestedBy = "oidc|forged-admin";
    clientPayload.decision.state = "pending";
    clientPayload.decision.approvals = [];
    clientPayload.groups = ["platform-admin:*"];
    clientPayload.principal = { id: "spiffe://evil", kind: "human", tenantId: "acme", groups: ["platform-approvers"] };
    const created = await fetch(base, { method: "POST", headers: { authorization: "Bearer requester", "content-type": "application/json" }, body: JSON.stringify(clientPayload) });
    assert.equal(created.status, 201);
    const stored = service.get("s103-workload-binding", { principal: requester });
    assert.equal(stored.decision.requestedBy, requester.id);
    assert.equal(stored.decision.approvals.length, 0);

    for (const authorization of ["Bearer approver-one", "Bearer tenant-b"]) {
      const res = await fetch(`${base}/s103-workload-binding/authorize`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ tenantId: "acme", executionId: "forged-execution" }) });
      assert.equal(res.status, 403);
    }
    const deniedCreate = await fetch(base, { method: "POST", headers: { authorization: "Bearer requester", "content-type": "application/json" }, body: JSON.stringify({ ...payload("s103-forged-approved"), decision: { ...payload().decision, state: "approved" } }) });
    assert.equal(deniedCreate.status, 400);
    assert.equal(service.get("s103-workload-binding", { principal: requester }).decision.state, "pending");

    service.decide("s103-workload-binding", { principal: approverOne, verdict: "approve" });
    service.decide("s103-workload-binding", { principal: approverTwo, verdict: "approve" });
    const allowed = await fetch(`${base}/s103-workload-binding/authorize`, {
      method: "POST",
      headers: { authorization: "Bearer workload", "content-type": "application/json" },
      body: JSON.stringify({ executionId: "server-execution-1", tenantId: "acme", verb: example.change.verb, environment: example.change.environment, target: example.change.targets[0], diffSha256: example.change.diff.sha256, parameters: example.change.parameters, policyBundleVersion: example.evidence.policyEvaluation.bundleVersion }),
    });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).ok, true);
    assert.equal(service.get("s103-workload-binding", { principal: requester }).decision.consumed.executorId, workload.id);
  });
});

test("in-process public service requires tenant context and exposes only isolated snapshots", () => {
  const { service, internal, audit } = fixture();
  const created = service.create(payload("s103-local"), { principal: requester });
  assert.equal(service.requests, undefined);
  assert.equal(service.store, undefined);
  assert.equal(service.audit, undefined);
  assert.equal(service.trusted, undefined);
  assert.equal(service.internal, undefined);

  created.decision.state = "approved";
  created.tenantId = "globex";
  const read = service.get("s103-local", { principal: requester });
  read.decision.state = "revoked";
  assert.equal(internal.store.get("s103-local").decision.state, "pending");
  assert.throws(() => service.get("s103-local"), (err) => err.status === 401);
  assert.throws(() => service.decide("s103-local", { principal: tenantB, verdict: "approve" }), (err) => err.status === 403);
  assert.equal(internal.store.get("s103-local").decision.state, "pending");
  assert.ok(audit.some((e) => e.type === "approval.access_denied"));
  assert.throws(() => service.create(payload("s103-local"), { principal: requester }), (err) => err.status === 409);
  assert.equal(internal.store.ids().filter((id) => id === "s103-local").length, 1);
});

test("same-tenant actors without the operation role cannot expire requests", () => {
  const { service, internal, setNow, audit } = fixture();
  const created = service.create(payload("s103-role-before-expiry"), { principal: requester });
  setNow(Date.parse(created.decision.expiresAt) + 1);
  assert.throws(() => service.decide(created.id, { principal: tenantMember, verdict: "approve" }), (err) => err.status === 403);
  assert.equal(internal.store.get(created.id).decision.state, "pending");
  assert.ok(audit.some((entry) => entry.type === "approval.access_denied" && entry.detail.operation === "decide"));
  assert.throws(() => service.decide(created.id, { principal: approverOne, verdict: "approve" }), (err) => err.status === 410);
  assert.equal(internal.store.get(created.id).decision.state, "expired");
});

test("public withdraw permits the requester and denies unowned internal requests", () => {
  const { service, internal, audit, setNow } = fixture();
  const ownRequest = service.create(payload("s103-own-withdraw"), { principal: requester });
  assert.equal(service.withdraw(ownRequest.id, { principal: requester }).decision.state, "withdrawn");

  internal.create(payload("s103-no-requester"));
  assert.equal(internal.store.get("s103-no-requester").decision.requestedBy, null);
  const expiresAt = internal.store.get("s103-no-requester").decision.expiresAt;
  setNow(Date.parse(expiresAt) + 1);
  for (const principal of [tenantMember, workload]) {
    assert.throws(() => service.withdraw("s103-no-requester", { principal }), (err) => err.status === 403);
  }
  assert.equal(internal.store.get("s103-no-requester").decision.state, "pending");
  assert.ok(audit.filter((entry) => entry.type === "approval.access_denied" && entry.detail.operation === "withdraw").length >= 2);
});

test("in-process executor consumption rejects humans and mismatched workloads", () => {
  const { service, internal } = fixture();
  const created = service.create(payload("s103-consume"), { principal: requester });
  for (const principal of [approverOne, { ...workload, id: "spiffe://platform.example.org/agents/other" }]) {
    assert.throws(() => service.authorizeExecution(created.id, {}, { principal }), (err) => err.status === 403);
  }
  assert.equal(internal.store.get(created.id).decision.consumed, undefined);
});

test("in-process executor consumption records the authenticated workload", () => {
  const { service, internal, audit } = fixture();
  const created = service.create(payload("s103-valid-consume"), { principal: requester });
  service.decide(created.id, { principal: approverOne, verdict: "approve" });
  service.decide(created.id, { principal: approverTwo, verdict: "approve" });
  const result = service.authorizeExecution(created.id, { executionId: "caller-execution-id", tenantId: "acme", verb: example.change.verb, environment: example.change.environment, target: example.change.targets[0], diffSha256: example.change.diff.sha256, parameters: example.change.parameters, policyBundleVersion: example.evidence.policyEvaluation.bundleVersion }, { principal: workload });
  assert.equal(result.ok, true);
  assert.equal(internal.store.get(created.id).decision.consumed.executorId, workload.id);
  assert.equal(audit.filter((entry) => entry.type === "approval.consumed").at(-1).actor, workload.id);
});

test("callback and input object mutation cannot rewrite request state", () => {
  const service = createApprovalService({ trainingRegistry: () => ["evidence-over-prose", "when-to-reject"], onDecision: ({ record }) => { record.verdict = "reject"; record.comment = "mutated callback"; } });
  const supplied = payload("s103-copy-isolation");
  const created = service.create(supplied, { principal: requester });
  supplied.decision.state = "approved";
  created.decision.state = "revoked";
  service.decide(created.id, { principal: approverOne, verdict: "approve" });
  const stored = service.get(created.id, { principal: requester });
  assert.equal(stored.decision.state, "pending");
  assert.equal(stored.decision.approvals[0].verdict, "approve");
  stored.decision.approvals[0].verdict = "reject";
  assert.equal(service.get(created.id, { principal: requester }).decision.approvals[0].verdict, "approve");
});

test("nested amend inputs are copied and object-valued metadata is rejected", () => {
  const { service } = fixture();
  const created = service.create(payload("s103-nested-amend"), { principal: requester });
  const patch = { evidence: { extension: { marker: "original" } }, agentAssessment: { rationale: "updated", extension: { marker: "original" } } };
  service.amend(created.id, patch, { principal: requester });
  patch.evidence.extension.marker = "mutated";
  patch.agentAssessment.extension.marker = "mutated";
  const stored = service.get(created.id, { principal: requester });
  assert.equal(stored.evidence.extension.marker, "original");
  assert.equal(stored.agentAssessment.extension.marker, "original");
  assert.throws(() => service.decide(created.id, { principal: approverOne, verdict: "approve", comment: { forged: true } }), (err) => err.status === 400);
  assert.throws(() => service.authorizeExecution(created.id, { executionId: { forged: true } }, { principal: workload }), (err) => err.status === 400);
});
