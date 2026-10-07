import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  correlateAlarm,
  acknowledgementState,
  riskyActionAllowed,
  problemCandidate,
  problemProblems,
  customerView,
  customerCases,
  majorIncidentCloseProblems,
  serviceProcessProblems,
  assessEditionCombination,
  itsmSeverity,
  createItsmService,
  normalizePolicy,
  ItsmError,
} from "../src/serviceregistry.mjs";
import { ITSM_EDITIONS, SEVERITIES } from "../src/constants.mjs";
import { createGlpiClient } from "../src/itsm.mjs";
import { createMockItsm } from "../src/mock-itsm.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const catalog = JSON.parse(readFileSync(join(repoRoot, "service-registry", "services.json"), "utf8"));
const rotations = JSON.parse(readFileSync(join(repoRoot, "service-registry", "oncall.json"), "utf8"));

const TENANT = "acme";
const NOW = Date.parse("2026-09-01T08:00:00Z");
const at = (offsetMinutes = 0) => () => NOW + offsetMinutes * 60000;

function alert(overrides = {}) {
  return { id: "alert-1", alertId: "alert-1", ruleId: "checkout-availability", signal: "http_requests_total", severity: "critical", summary: "Checkout 5xx", emittedAt: "2026-09-01T08:00:00Z", ...overrides };
}

test("itsmSeverity mapper alarm-/sensorniveauer", () => {
  assert.equal(itsmSeverity("critical"), "sev1");
  assert.equal(itsmSeverity("warning"), "sev2");
  assert.equal(itsmSeverity("sev4"), "sev4");
  assert.equal(itsmSeverity("nonsense"), "sev3");
});

test("én alarm bliver én incident med ejer og berørte tjenester", () => {
  const { incident, created } = correlateAlarm({ alert: alert(), serviceId: "checkout", catalog, rotations, incidents: [], tenantId: TENANT, now: at() });
  assert.equal(created, true);
  assert.equal(incident.recordKind, "major_incident");
  assert.equal(incident.owner.subject, "oidc|bo.bertelsen");
  assert.deepEqual(incident.affectedServices, ["checkout", "identity", "database", "notifications"]);
  assert.equal(incident.correlatedAlerts.length, 1);
});

test("samme alarm-id er idempotent, og samme korrelationsnøgle samler alarmer", () => {
  const first = correlateAlarm({ alert: alert(), serviceId: "checkout", catalog, rotations, incidents: [], tenantId: TENANT, now: at() }).incident;
  const replay = correlateAlarm({ alert: alert(), serviceId: "checkout", catalog, rotations, incidents: [first], tenantId: TENANT, now: at(1) });
  assert.equal(replay.created, false);
  assert.equal(replay.incident.id, first.id);
  const second = correlateAlarm({ alert: alert({ id: "alert-2", alertId: "alert-2", emittedAt: "2026-09-01T08:01:00Z" }), serviceId: "checkout", catalog, rotations, incidents: [first], tenantId: TENANT, now: at(1) });
  assert.equal(second.created, false);
  assert.equal(second.incident.id, first.id);
  assert.equal(second.incident.correlatedAlerts.length, 2);
});

test("manglende kvittering eskalerer og stopper risikofyldt handling", () => {
  const { incident } = correlateAlarm({ alert: alert(), serviceId: "checkout", catalog, rotations, incidents: [], tenantId: TENANT, now: at() });
  const before = acknowledgementState({ record: incident, catalog, rotations, now: at(1) });
  assert.equal(before.acknowledged, false);
  assert.equal(before.overdue, false);
  assert.equal(riskyActionAllowed({ record: incident, catalog, rotations, now: at(1) }).allowed, false);

  const overdue = acknowledgementState({ record: incident, catalog, rotations, now: at(20) });
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.target.subject, "oidc|maja.mortensen");

  const acknowledged = { ...incident, humanAck: { subject: "oidc|bo.bertelsen", name: "Bo Bertelsen", at: "2026-09-01T08:05:00Z" } };
  assert.equal(riskyActionAllowed({ record: acknowledged, catalog, rotations, now: at(20) }).allowed, true);
});

test("gentagne incidents giver et problem med menneskelig validering", () => {
  const incidents = [];
  for (let i = 0; i < 3; i++) {
    const { incident } = correlateAlarm({ alert: alert({ id: `a-${i}`, alertId: `a-${i}` }), serviceId: "checkout", catalog, rotations, incidents: [], tenantId: TENANT, now: at(i) });
    incidents.push({ ...incident, id: `INC-${i}`, state: "closed" });
  }
  const proposals = problemCandidate({ incidents, threshold: 3, now: at(60) });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].incidentIds.length, 3);
  assert.ok(problemProblems({ proposal: { ...proposals[0], verifiedBy: { subject: "oidc|maja.mortensen" } }, threshold: 3 }).length === 0);
  assert.ok(problemProblems({ proposal: proposals[0], threshold: 3 }).some((p) => /menneskelig/.test(p)));
});

test("kunden ser kun egne sager og kundevendte felter", () => {
  const record = { id: "INC-1", recordKind: "incident", title: "Nede", state: "investigating", severity: "sev2", serviceId: "checkout", tenantId: TENANT, customerVisible: true, owner: { subject: "oidc|bo.bertelsen", name: "Bo", role: "On-call" }, aiActions: [{ agentId: "x" }], createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z", resolvedAt: null };
  const own = customerCases({ actor: { tenantId: TENANT }, records: [record], policy: {} });
  assert.equal(own.length, 1);
  assert.equal(own[0].owner, undefined);
  assert.equal(own[0].aiActions, undefined);
  const foreign = customerCases({ actor: { tenantId: "globex" }, records: [record], policy: {} });
  assert.deepEqual(foreign, []);
  assert.equal(customerView({ record: { ...record, customerVisible: false }, policy: {} }), null);
});

test("en AI må ikke lukke en major incident, heller ikke på grønt healthcheck", () => {
  const record = { recordKind: "major_incident", humanAck: { subject: "oidc|bo.bertelsen", name: "Bo", at: "2026-09-01T08:05:00Z" } };
  const ai = majorIncidentCloseProblems({ record, actor: { kind: "agent", id: "spiffe://x" }, healthcheck: "green", approvals: [], policy: {} });
  assert.ok(ai.some((p) => /kun et menneske/.test(p)));
  const greenOnly = majorIncidentCloseProblems({ record, actor: { kind: "human", id: "oidc|maja.mortensen" }, healthcheck: "green", approvals: [], policy: {} });
  assert.ok(greenOnly.some((p) => /grønt healthcheck|godkendelse/.test(p)));
  const noAck = majorIncidentCloseProblems({ record: { recordKind: "major_incident", humanAck: null }, actor: { kind: "human", id: "oidc|maja.mortensen" }, approvals: [{ kind: "human", verdict: "approve" }], policy: {} });
  assert.ok(noAck.some((p) => /kvittering/.test(p)));
  const ok = majorIncidentCloseProblems({ record, actor: { kind: "human", id: "oidc|maja.mortensen" }, healthcheck: "green", approvals: [{ kind: "human", verdict: "approve" }], policy: {} });
  assert.deepEqual(ok, []);
});

test("en agent må ikke kombinere roller i en serviceproces", () => {
  const agents = [
    { id: "spiffe://platform.example.org/agents/observe", role: "observer" },
    { id: "spiffe://platform.example.org/agents/exec", role: "executor" },
  ];
  const process = { id: "checkout-flow", serviceId: "checkout", steps: [{ name: "opdag", role: "observer", agentId: agents[0].id }, { name: "genstart", role: "executor", agentId: agents[1].id }] };
  assert.deepEqual(serviceProcessProblems({ process, agents }), []);
  const combined = { ...process, steps: [...process.steps, { name: "planlæg", role: "planner", agentId: agents[0].id }] };
  assert.ok(serviceProcessProblems({ process: combined, agents }).some((p) => /kombinerer/.test(p)));
  const mismatch = { ...process, steps: [{ name: "opdag", role: "executor", agentId: agents[0].id }] };
  assert.ok(serviceProcessProblems({ process: mismatch, agents }).some((p) => /har rollen/.test(p)));
});

test("editionkombinationen frigiver kun validerede delmoduler", () => {
  const network = assessEditionCombination(ITSM_EDITIONS["glpi-network"]);
  assert.equal(network.status, "approved");
  assert.equal(network.submodules.sla.released, true);
  const community = assessEditionCombination(ITSM_EDITIONS["glpi-community"]);
  assert.equal(community.status, "partial");
  assert.equal(community.submodules.sla.released, false);
  assert.equal(community.submodules.incidents.released, true);
});

test("normalizePolicy arver de restriktive standarder", () => {
  const policy = normalizePolicy({ problem: { repeatThreshold: 5 } });
  assert.equal(policy.majorIncident.requiresHumanClose, true);
  assert.equal(policy.customer.exposeOwnerIdentity, false);
  assert.equal(policy.problem.repeatThreshold, 5);
});

async function serviceWith(policy = {}) {
  const mock = createMockItsm();
  const port = await mock.listen(0);
  const client = createGlpiClient({ baseUrl: `http://127.0.0.1:${port}`, appToken: "test-app-token", userToken: "test-user-token" });
  const audits = [];
  const service = createItsmService({ client, catalog, rotations, policy, onAudit: (e) => audits.push(e), now: at() });
  return { mock, client, service, audits, close: () => mock.close() };
}

test("fuld ITSM-kæde: alarm, kvittering, change, problem og lukning", async () => {
  const { service, audits, close } = await serviceWith();
  try {
    const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/itsm-observer" };
    const human = { kind: "human", id: "oidc|maja.mortensen", name: "Maja Mortensen", role: "Service Owner" };
    const ingested = await service.ingestAlarm({ actor: agent, alert: alert(), serviceId: "checkout", tenantId: TENANT });
    assert.equal(ingested.created, true);
    const incidentId = ingested.incident.id;

    const change = await service.createChange({
      actor: human,
      tenantId: TENANT,
      change: { title: "Rul checkout tilbage", serviceId: "checkout", incidentIds: [incidentId], rollbackPlan: "Rul frem igen" },
      approvals: [{ id: "APR-1", subject: "oidc|anna.andersen", name: "Anna Andersen", verdict: "approve", kind: "human" }],
    });
    assert.equal(change.recordKind, "change");
    assert.deepEqual(change.links.incidentIds, [incidentId]);

    const request = await service.createRequest({ actor: human, tenantId: TENANT, request: { title: "Ny konto", serviceId: "identity", description: "ønskes" } });
    assert.equal(request.recordKind, "request");
    assert.equal(request.requester.subject, human.id);

    const acked = await service.acknowledgeIncident({ actor: { ...human, id: "oidc|bo.bertelsen", name: "Bo Bertelsen" }, incidentId, tenantId: TENANT });
    assert.equal(acked.state, "acknowledged");

    const closed = await service.closeIncident({ actor: human, incidentId, tenantId: TENANT, healthcheck: "green", approvals: [{ id: "APR-2", subject: "oidc|anna.andersen", name: "Anna Andersen", verdict: "approve", kind: "human" }] });
    assert.equal(closed.state, "closed");
    assert.equal(closed.closedBy.kind, "human");
    assert.ok(audits.some((a) => a.type === "itsm.incident.closed"));
  } finally {
    await close();
  }
});

test("et change uden runbook eller godkendelse afvises", async () => {
  const { service, close } = await serviceWith();
  try {
    const human = { kind: "human", id: "oidc|maja.mortensen", name: "Maja Mortensen", role: "Service Owner" };
    await assert.rejects(
      () => service.createChange({ actor: human, tenantId: TENANT, change: { title: "x", serviceId: "checkout", incidentIds: ["INC-1"] }, approvals: [] }),
      (err) => err instanceof ItsmError && err.code === "change_denied"
    );
  } finally {
    await close();
  }
});

test("kun et menneske må validere et problem", async () => {
  const { service, close } = await serviceWith();
  try {
    const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/itsm-planner" };
    await assert.rejects(
      () => service.createProblem({ actor: agent, tenantId: TENANT, proposal: { serviceId: "checkout", incidentIds: ["INC-1", "INC-2", "INC-3"], knownError: { rootCause: "x" } } }),
      (err) => err instanceof ItsmError && err.code === "human_required"
    );
  } finally {
    await close();
  }
});
