import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuditService } from "../src/server.mjs";
import { createSubjectStore } from "../src/store.mjs";
import { GovernanceUnavailable } from "../src/pdp-client.mjs";
import { AuthError } from "../src/auth.mjs";

const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/x", spiffeId: "spiffe://platform.example.org/agents/x", autonomyClass: "A3", onBehalfOf: "oidc-group:platform-approvers" };
const authenticate = (auth) => {
  if (!auth) throw new AuthError("manglende token");
  return agent;
};

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const approvalPdp = { decide: async () => ({ decision: "allow-with-approval", requiredApprovals: 2, requiredEvidence: ["policy-allow", "tests-pass"] }) };
const denyPdp = { decide: async () => ({ decision: "deny", reasons: ["nej"], matchedRules: ["r"] }) };
const downPdp = { decide: async () => { throw new GovernanceUnavailable("timeout"); } };

async function start(pdp, { subjects } = {}) {
  const service = createAuditService({ authenticate, pdp, subjects });
  const port = await service.listen(0);
  const call = (path, { method = "POST", body, auth = "Bearer test" } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { service, call, close: () => service.close() };
}

test("health kræver ingen autentifikation", async () => {
  const { call, close } = await start(allowPdp);
  try {
    const res = await call("/healthz", { method: "GET", auth: null });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "ok");
  } finally {
    await close();
  }
});

test("manglende identitet afvises", async () => {
  const { call, close } = await start(allowPdp);
  try {
    const res = await call("/v1/ops/backup", { body: {}, auth: null });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("tillad handling udføres og audit-logges", async () => {
  const { service, call, close } = await start(allowPdp);
  try {
    const res = await call("/v1/ops/backup", { body: { evidence: ["policy-allow"] } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.verb, "backup");
    assert.equal(body.decision, "allow");
    assert.ok(service.log.events.some((e) => e.type === "backup.completed"));
    assert.equal(service.log.verifyChain().ok, true);
  } finally {
    await close();
  }
});

test("allow-with-approval kræver det rigtige antal godkendelser", async () => {
  const { call, close } = await start(approvalPdp);
  try {
    const first = await call("/v1/ops/upgrade", { body: { evidence: ["policy-allow", "tests-pass"] } });
    assert.equal(first.status, 428);
    assert.equal((await first.json()).requiredApprovals, 2);

    const second = await call("/v1/ops/upgrade", {
      body: { evidence: ["policy-allow", "tests-pass"], approvals: [{ subject: "a" }, { subject: "b" }] },
    });
    assert.equal(second.status, 200);
  } finally {
    await close();
  }
});

test("manglende påkrævet evidens afvises", async () => {
  const { call, close } = await start(approvalPdp);
  try {
    const res = await call("/v1/ops/upgrade", { body: { evidence: ["policy-allow"], approvals: [{ subject: "a" }, { subject: "b" }] } });
    assert.equal(res.status, 428);
    assert.deepEqual((await res.json()).missingEvidence, ["tests-pass"]);
  } finally {
    await close();
  }
});

test("deny stopper handlingen og logges", async () => {
  const { service, call, close } = await start(denyPdp);
  try {
    const res = await call("/v1/ops/upgrade", { body: {} });
    assert.equal(res.status, 403);
    assert.ok(service.log.events.some((e) => e.type === "policy.denied"));
    assert.ok(!service.log.events.some((e) => e.type === "upgrade.completed"));
  } finally {
    await close();
  }
});

test("utilgængelig PDP betyder ingen handling (fail-closed)", async () => {
  const { service, call, close } = await start(downPdp);
  try {
    const res = await call("/v1/ops/upgrade", { body: {} });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).failMode, "closed");
    assert.ok(service.log.events.some((e) => e.type === "governance.unavailable"));
    assert.ok(!service.log.events.some((e) => e.type.endsWith(".completed")));
  } finally {
    await close();
  }
});

test("privacy erase fjerner data og locate ser forskellen", async () => {
  const subjects = createSubjectStore();
  subjects.add({ subjects: [{ type: "email", value: "kunde@example.org" }], dataCategories: ["personal"] });
  const { call, close } = await start(allowPdp, { subjects });
  try {
    const identifiers = [{ type: "email", value: "kunde@example.org" }];
    const before = await (await call("/v1/privacy/locate", { body: { identifiers } })).json();
    assert.equal(before.result.count, 1);
    const erased = await (await call("/v1/privacy/erase", { body: { identifiers, evidence: ["policy-allow"] } })).json();
    assert.equal(erased.result.recordsAffected, 1);
    const after = await (await call("/v1/privacy/locate", { body: { identifiers } })).json();
    assert.equal(after.result.count, 0);
  } finally {
    await close();
  }
});

test("agenthandling udsender CloudEvent med tenantid, traceid og principal", async () => {
  const { service, call, close } = await start(allowPdp);
  try {
    await call("/v1/ops/backup", { body: { evidence: ["policy-allow"], tenantId: "acme" } });
    const event = service.emitted.at(-1);
    assert.equal(event.tenantid, "acme");
    assert.match(event.traceid, /^[0-9a-f]{32}$/);
    assert.equal(event.principal.kind, "agent");
    assert.deepEqual(event.principal.onBehalfOf, { kind: "group", id: "oidc-group:platform-approvers" });
  } finally {
    await close();
  }
});
