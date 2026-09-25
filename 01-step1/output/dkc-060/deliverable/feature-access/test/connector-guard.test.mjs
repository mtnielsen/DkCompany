import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuardedConnector, connectorGuardProblems, bindParams, isAdminCredential } from "../src/index.mjs";

const TEMPLATES = [
  { id: "salary-by-period", sql: "select salary from hr.payroll where period = ?", parameters: [{ name: "period", required: true }] },
  { id: "headcount", sql: "select count(*) from hr.employees", parameters: [] },
];

function underlying() {
  const calls = [];
  return {
    calls,
    query: async (principal, sql, params) => {
      calls.push({ principal, sql, params });
      return { rowCount: 1, rows: [] };
    },
  };
}

const service = { id: "svc|reporting", tenantId: "acme", roles: ["service-account"], grants: ["read:hr"], verified: true };

test("rå SQL og vilkårlige forespørgsler afvises", async () => {
  const guard = createGuardedConnector({ connector: underlying(), templates: TEMPLATES });
  await assert.rejects(() => guard.query(service, "select * from hr.payroll"), /rå SQL/);
  await assert.rejects(() => guard.query(service, { templateId: "ukendt" }), /ikke godkendt/);
});

test("administratorcredentials må ikke bruges til forretningsforespørgsler", async () => {
  const admin = { id: "dba|root", tenantId: "acme", roles: ["platform-admin", "dba"], verified: true };
  const guard = createGuardedConnector({ connector: underlying(), templates: TEMPLATES });
  await assert.rejects(() => guard.query(admin, { templateId: "headcount" }), /administratorcredentials/);
  assert.equal(isAdminCredential(admin), true);
});

test("connectoren kræver en afgrænset tjenestekonto", async () => {
  const human = { id: "oidc|hr.bruger", tenantId: "acme", roles: ["hr-user"], verified: true };
  const guard = createGuardedConnector({ connector: underlying(), templates: TEMPLATES });
  await assert.rejects(() => guard.query(human, { templateId: "headcount" }), /tjenestekonto/);
});

test("en godkendt parameteriseret skabelon kalder den underliggende connector", async () => {
  const connector = underlying();
  const guard = createGuardedConnector({ connector, templates: TEMPLATES });
  await guard.query(service, { templateId: "salary-by-period", params: { period: "2025-09" } });
  assert.equal(connector.calls.length, 1);
  assert.equal(connector.calls[0].sql, TEMPLATES[0].sql);
  assert.deepEqual(connector.calls[0].params, ["2025-09"]);
  assert.equal(guard.auditTrail().at(-1).allowed, true);
});

test("en ikke-erklæret parameter afvises", async () => {
  const guard = createGuardedConnector({ connector: underlying(), templates: TEMPLATES });
  await assert.rejects(() => guard.query(service, { templateId: "salary-by-period", params: { period: "2025-09", injection: "1=1" } }), /ikke erklæret/);
});

test("en skabelon der ikke er tilladt for funktionen afvises", async () => {
  const guard = createGuardedConnector({ connector: underlying(), templates: TEMPLATES, allowedTemplateIds: ["headcount"] });
  await assert.rejects(() => guard.query(service, { templateId: "salary-by-period", params: { period: "2025-09" } }), /ikke godkendt/);
});

test("bindParams kræver obligatoriske parametre", () => {
  assert.deepEqual(bindParams(TEMPLATES[0], { period: "x" }), ["x"]);
  assert.throws(() => bindParams(TEMPLATES[0], {}), /mangler/);
});

test("connectorGuardProblems opdager manglende skabeloner", () => {
  assert.ok(connectorGuardProblems({ templates: [] }).length > 0);
  assert.equal(connectorGuardProblems({ templates: TEMPLATES, allowedTemplateIds: ["headcount"] }).length, 0);
});
