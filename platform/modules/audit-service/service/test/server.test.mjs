import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuditService } from "../src/server.mjs";
import { createSubjectStore } from "../src/store.mjs";
import { GovernanceUnavailable } from "../src/pdp-client.mjs";
import { AuthError } from "../src/auth.mjs";

const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/x", spiffeId: "spiffe://platform.example.org/agents/x", tenantId: "acme", autonomyClass: "A3", onBehalfOf: "oidc-group:platform-approvers" };
const authenticate = (auth) => {
  if (!auth) throw new AuthError("manglende token");
  return agent;
};

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const approvalPdp = { decide: async () => ({ decision: "allow-with-approval", requiredApprovals: 2, requiredEvidence: ["policy-allow", "tests-pass"] }) };
const denyPdp = { decide: async () => ({ decision: "deny", reasons: ["nej"], matchedRules: ["r"] }) };
const downPdp = { decide: async () => { throw new GovernanceUnavailable("timeout"); } };

async function start(pdp, { subjects, authenticateFn = authenticate } = {}) {
  const service = createAuditService({ authenticate: authenticateFn, pdp, subjects });
  const port = await service.listen(0);
  const call = (path, { method = "POST", body, auth = "Bearer test" } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { service, port, call, close: () => service.close() };
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
  subjects.add({ tenantId: "acme", subjects: [{ type: "email", value: "kunde@example.org" }], dataCategories: ["personal"] });
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

test("tenant-påstand i body der afviger fra identiteten afvises", async () => {
  let pdpCalled = false;
  const pdp = { decide: async () => { pdpCalled = true; return { decision: "allow" }; } };
  const { service, call, close } = await start(pdp);
  try {
    const res = await call("/v1/ops/backup", { body: { tenantId: "globex", evidence: ["policy-allow"] } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "tenant_mismatch");
    assert.equal(pdpCalled, false, "PDP må ikke kaldes for en afvist tenant");
    assert.ok(service.log.events.some((e) => e.type === "tenant.rejected"));
  } finally {
    await close();
  }
});

test("tenant-påstand i header der afviger fra identiteten afvises", async () => {
  const { port, close } = await start(allowPdp);
  try {
    const mismatch = await fetch(`http://127.0.0.1:${port}/v1/ops/backup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "globex", authorization: "Bearer test" },
      body: JSON.stringify({ evidence: ["policy-allow"] }),
    });
    assert.equal(mismatch.status, 403);
    assert.equal((await mismatch.json()).code, "tenant_mismatch");
  } finally {
    await close();
  }
});

test("audit-oplæsning returnerer kun principalens egen kundes events", async () => {
  const { service, call, close } = await start(allowPdp);
  try {
    service.log.append({ type: "acme.event", tenantId: "acme", principal: { kind: "human", id: "a" }, payload: {} });
    service.log.append({ type: "globex.event", tenantId: "globex", principal: { kind: "human", id: "g" }, payload: {} });
    const acme = await (await call("/v1/audit/events", { method: "GET" })).json();
    assert.ok(acme.events.every((e) => e.tenantId === "acme"));
    assert.ok(acme.events.some((e) => e.type === "acme.event"));
    assert.ok(!acme.events.some((e) => e.type === "globex.event"));
  } finally {
    await close();
  }
});

test("privacy locate og erase er tenantafgrænset ved identiske identifikatorer", async () => {
  const subjects = createSubjectStore();
  subjects.add({ tenantId: "acme", subjects: [{ type: "email", value: "fælles@example.org" }], dataCategories: ["personal"] });
  subjects.add({ tenantId: "globex", subjects: [{ type: "email", value: "fælles@example.org" }], dataCategories: ["personal"] });
  const { call, close } = await start(allowPdp, { subjects });
  try {
    const identifiers = [{ type: "email", value: "fælles@example.org" }];
    const locate = await (await call("/v1/privacy/locate", { body: { identifiers } })).json();
    assert.equal(locate.result.count, 1);
    const exportRes = await (await call("/v1/privacy/export", { body: { identifiers } })).json();
    assert.equal(exportRes.result.count, 1);
    assert.ok(exportRes.result.artifactRef.includes("/acme/"));
    const erase = await (await call("/v1/privacy/erase", { body: { identifiers, evidence: ["policy-allow"] } })).json();
    assert.equal(erase.result.recordsAffected, 1);
    assert.equal(subjects.locate("globex", identifiers).length, 1, "globex må ikke være slettet");
    assert.equal(subjects.locate("acme", identifiers).length, 0);
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
