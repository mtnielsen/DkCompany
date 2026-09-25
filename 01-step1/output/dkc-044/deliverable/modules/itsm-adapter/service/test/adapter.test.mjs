import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createItsmAdapter } from "../src/server.mjs";
import { createGlpiClient } from "../src/itsm.mjs";
import { createMockItsm } from "../src/mock-itsm.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const catalog = JSON.parse(readFileSync(join(repoRoot, "service-registry", "services.json"), "utf8"));
const rotations = JSON.parse(readFileSync(join(repoRoot, "service-registry", "oncall.json"), "utf8"));

const ROLES_BY_USER = { anna: "tenant-admin", bo: "on-call", maja: "service-owner" };

function testAuthenticate(_auth, headers = {}) {
  const kind = headers["x-test-kind"];
  if (!kind) {
    const err = new Error("manglende verificeret identitet");
    err.code = "unauthenticated";
    throw err;
  }
  const userId = headers["x-test-user"] ?? "anna";
  const tenantId = headers["x-test-tenant"] ?? "acme";
  return { kind, id: `oidc|${userId}`, name: userId, tenantId, role: ROLES_BY_USER[userId] ?? null, groups: [tenantId] };
}

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const denyPdp = { decide: async () => ({ decision: "deny", reasons: ["nej"] }) };
const downPdp = {
  decide: async () => {
    const err = new Error("timeout");
    err.name = "GovernanceUnavailable";
    throw err;
  },
};

async function setup(pdp, policy = {}) {
  const mock = createMockItsm();
  const mockPort = await mock.listen(0);
  const adapter = createItsmAdapter({
    authenticate: testAuthenticate,
    pdp,
    client: createGlpiClient({ baseUrl: `http://127.0.0.1:${mockPort}`, appToken: "test-app-token", userToken: "test-user-token" }),
    catalog,
    rotations,
    policy,
  });
  const port = await adapter.listen(0);
  const call = (path, { method = "POST", body, headers = {} } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-test-kind": "human", "x-test-user": "maja", "x-test-tenant": "acme", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { mock, port, call, adapter, close: async () => { await adapter.close(); await mock.close(); } };
}

const ALARM = { alert: { id: "alert-1", alertId: "alert-1", ruleId: "checkout-availability", signal: "http_requests_total", severity: "critical", summary: "Checkout 5xx", emittedAt: "2026-09-01T08:00:00Z" }, serviceId: "checkout", evidence: ["policy-allow"] };

test("health spejler upstreams version og ping", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/healthz", { method: "GET" });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.upstream, "glpi");
    assert.equal(body.upstreamStatus, "ok");
  } finally {
    await close();
  }
});

test("manglende verificeret identitet afvises", async () => {
  const { port, close } = await setup(allowPdp);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/itsm/alarms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ALARM) });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("en alarm bliver én incident med ejer og berørte tjenester over HTTP", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/itsm/alarms", { headers: { "x-test-kind": "agent" }, body: ALARM });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.created, true);
    assert.equal(body.result.owner.subject, "oidc|bo.bertelsen");
    assert.deepEqual(body.result.affectedServices, ["checkout", "identity", "database", "notifications"]);
    const replay = await call("/v1/itsm/alarms", { headers: { "x-test-kind": "agent" }, body: ALARM });
    assert.equal((await replay.json()).result.created, false);
  } finally {
    await close();
  }
});

test("kvittering kræver et menneske og en AI kan ikke lukke en major incident", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const ingested = await call("/v1/itsm/alarms", { headers: { "x-test-kind": "agent" }, body: ALARM });
    const incidentId = (await ingested.json()).result.incidentId;

    const agentAck = await call("/v1/itsm/incidents/acknowledge", { headers: { "x-test-kind": "agent" }, body: { incidentId, evidence: ["policy-allow"] } });
    assert.equal(agentAck.status, 403);
    assert.equal((await agentAck.json()).code, "human_required");

    const humanAck = await call("/v1/itsm/incidents/acknowledge", { body: { incidentId, evidence: ["policy-allow"] } });
    assert.equal(humanAck.status, 200);
    assert.equal((await humanAck.json()).result.state, "acknowledged");

    const agentClose = await call("/v1/itsm/incidents/close", { headers: { "x-test-kind": "agent" }, body: { incidentId, healthcheck: "green", approvals: [{ kind: "human", verdict: "approve" }], evidence: ["policy-allow"] } });
    assert.equal(agentClose.status, 409);
    assert.equal((await agentClose.json()).code, "close_denied");

    const humanClose = await call("/v1/itsm/incidents/close", { body: { incidentId, healthcheck: "green", approvals: [{ kind: "human", verdict: "approve", subject: "oidc|anna", name: "Anna" }], evidence: ["policy-allow"] } });
    assert.equal(humanClose.status, 200);
    assert.equal((await humanClose.json()).result.closedBy.kind, "human");
  } finally {
    await close();
  }
});

test("escalation rapporterer næste menneske", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const ingested = await call("/v1/itsm/alarms", { headers: { "x-test-kind": "agent" }, body: ALARM });
    const incidentId = (await ingested.json()).result.incidentId;
    const res = await call("/v1/itsm/incidents/escalate", { body: { incidentId, evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.result.target);
    assert.equal(typeof body.result.overdue, "boolean");
  } finally {
    await close();
  }
});

test("change kræver runbook, godkendelse og incidentkobling", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const denied = await call("/v1/itsm/changes", { body: { change: { title: "Rul tilbage", serviceId: "checkout" }, evidence: ["policy-allow"] } });
    assert.equal(denied.status, 409);
    const ok = await call("/v1/itsm/changes", { body: { change: { title: "Rul tilbage", serviceId: "checkout", incidentIds: ["INC-1"] }, approvals: [{ subject: "oidc|anna", name: "Anna", verdict: "approve", kind: "human" }], evidence: ["policy-allow"] } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).result.recordKind, "change");
  } finally {
    await close();
  }
});

test("kunden ser kun egne sager og kundevendte felter", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    await call("/v1/itsm/alarms", { headers: { "x-test-kind": "agent" }, body: ALARM });
    const own = await call("/v1/itsm/cases", { body: { evidence: ["policy-allow"] } });
    const ownBody = await own.json();
    assert.equal(own.status, 200);
    assert.equal(ownBody.result.cases.length, 1);
    assert.equal(ownBody.result.cases[0].owner, undefined);

    const foreign = await call("/v1/itsm/cases", { headers: { "x-test-tenant": "globex" }, body: { evidence: ["policy-allow"] } });
    assert.equal(foreign.status, 200);
    assert.deepEqual((await foreign.json()).result.cases, []);
  } finally {
    await close();
  }
});

test("privacy locate/export er ærligt partial", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const locate = await call("/v1/privacy/locate", { headers: { "x-test-kind": "agent" }, body: { identifiers: [{ type: "email", value: "bo.bertelsen" }], evidence: ["policy-allow"] } });
    assert.equal(locate.status, 200);
    assert.equal((await locate.json()).result.partial, true);
    const erase = await call("/v1/privacy/erase", { headers: { "x-test-kind": "agent" }, body: { identifiers: [{ type: "email", value: "bo.bertelsen" }], evidence: ["policy-allow"] } });
    const eraseBody = await erase.json();
    assert.equal(erase.status, 200);
    assert.equal(eraseBody.result.partial, true);
    assert.ok(eraseBody.result.remainingCopies.some((c) => c.location === "backup"));
  } finally {
    await close();
  }
});

test("procesvalidering afviser en agent med flere roller", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const agents = [{ id: "a1", role: "observer" }, { id: "a2", role: "executor" }];
    const good = await call("/v1/itsm/processes/validate", { body: { process: { id: "p", serviceId: "checkout", steps: [{ name: "x", role: "observer", agentId: "a1" }, { name: "y", role: "executor", agentId: "a2" }] }, agents, evidence: ["policy-allow"] } });
    assert.equal((await good.json()).result.ok, true);
    const bad = await call("/v1/itsm/processes/validate", { body: { process: { id: "p", serviceId: "checkout", steps: [{ name: "x", role: "observer", agentId: "a1" }, { name: "y", role: "planner", agentId: "a1" }] }, agents, evidence: ["policy-allow"] } });
    assert.equal((await bad.json()).result.ok, false);
  } finally {
    await close();
  }
});

test("editionkombinationen vurderes pr. delmodul", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/itsm/editions/assess", { body: { combination: "glpi-community", evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.submodules.sla.released, false);
    assert.equal(body.result.submodules.incidents.released, true);
  } finally {
    await close();
  }
});

test("deny stopper alarmindtag", async () => {
  const { mock, call, close } = await setup(denyPdp);
  try {
    const res = await call("/v1/itsm/alarms", { headers: { "x-test-kind": "agent" }, body: ALARM });
    assert.equal(res.status, 403);
    assert.equal(mock.records.size, 0);
  } finally {
    await close();
  }
});

test("utilgængelig PDP betyder ingen sag (fail-closed)", async () => {
  const { mock, call, close } = await setup(downPdp);
  try {
    const res = await call("/v1/itsm/alarms", { headers: { "x-test-kind": "agent" }, body: ALARM });
    assert.equal(res.status, 503);
    assert.equal(mock.records.size, 0);
  } finally {
    await close();
  }
});
