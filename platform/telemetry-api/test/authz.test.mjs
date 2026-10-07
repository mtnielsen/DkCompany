import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilitiesFor, authorizeView, authorizeAggregate, redactSensitive, createViewCache, createTelemetryAiTool, assertReadOnly } from "../src/authz.mjs";
import { acmeOperator, acmeAdmin, globexPlatformAdmin, securityOfficer, aiOwner, NOW } from "./support/fixtures.mjs";

test("kapabiliteter kræver både rolle og view-scope", () => {
  const caps = capabilitiesFor(acmeOperator);
  assert.ok(caps.views.has("operations"));
  assert.ok(caps.views.has("test-release"));
  assert.ok(!caps.views.has("vulnerabilities"));
  assert.ok(!caps.views.has("recovery"));
  assert.ok(!caps.views.has("ai"));
  assert.ok(capabilitiesFor(securityOfficer).views.has("vulnerabilities"));
  assert.equal(caps.canExecute, false);
  assert.equal(caps.readOnly, true);
  const noScope = capabilitiesFor({ id: "oidc|nobody", tenantId: "acme", roles: ["operator"] });
  assert.equal(noScope.views.size, 0);
});

test("authorizeView afviser manglende scope og kræver global rolle for hostdata", () => {
  assert.equal(authorizeView({ principal: acmeOperator, view: "operations", tenantId: "acme" }).allowed, true);
  assert.equal(authorizeView({ principal: acmeOperator, view: "recovery", tenantId: "acme" }).allowed, false);
  assert.equal(authorizeView({ principal: acmeOperator, view: "operations", tenantId: "acme", global: true }).allowed, false);
  assert.equal(authorizeView({ principal: acmeAdmin, view: "operations", tenantId: "acme", global: true }).allowed, true);
});

test("krydskunde-læsning kræver en scopet platformrolle", () => {
  assert.equal(authorizeView({ principal: acmeOperator, view: "operations", tenantId: "globex" }).allowed, false);
  assert.equal(authorizeView({ principal: globexPlatformAdmin, view: "operations", tenantId: "globex" }).allowed, true);
});

test("følsomme HR- og AI-felter fjernes for principaler uden rolle", () => {
  const payload = { service: "hr", salary: 60000, employee: { cpr: "010190-1234", name: "Ansat" }, prompt: "hemmelig", completion: "svar" };
  const operator = redactSensitive(payload, { view: "ai", principal: acmeOperator });
  assert.equal(operator.value.salary, "[REDACTED]");
  assert.equal(operator.value.employee, "[REDACTED]");
  assert.equal(operator.value.prompt, "[REDACTED]");
  assert.ok(operator.redactions.length >= 3);
  const admin = redactSensitive(payload, { view: "ai", principal: acmeAdmin });
  assert.equal(admin.value.salary, 60000);
  assert.equal(admin.value.employee.cpr, "010190-1234");
});

test("aggregering på hostniveau kræver en global rolle", () => {
  assert.equal(authorizeAggregate({ principal: acmeOperator, view: "operations", tenantId: "acme", granularity: "host" }).allowed, false);
  assert.equal(authorizeAggregate({ principal: acmeAdmin, view: "operations", tenantId: "acme", granularity: "host" }).allowed, true);
});

test("cachen er tenant-scopet og genautoriserer ved hit", () => {
  const cache = createViewCache({ clock: () => NOW });
  cache.set({ tenantId: "acme", view: "operations", params: {}, data: { status: "pass" }, now: NOW });
  const hit = cache.get({ principal: acmeOperator, tenantId: "acme", view: "operations", params: {}, now: NOW });
  assert.equal(hit.hit, true);
  assert.equal(hit.data.status, "pass");
  const denied = cache.get({ principal: acmeOperator, tenantId: "globex", view: "operations", params: {}, now: NOW });
  assert.equal(denied.allowed, false);
  const miss = cache.get({ principal: acmeOperator, tenantId: "acme", view: "operations", params: { other: 1 }, now: NOW });
  assert.equal(miss.hit, false);
});

test("AI-værktøjet afviser uden scope og returnerer kun minimerede data", async () => {
  const cache = createViewCache({ clock: () => NOW });
  cache.set({ tenantId: "acme", view: "ai", params: {}, data: { aggregates: { actions: 1 }, items: [{ prompt: "hemmelig", verb: "upgrade" }], status: "pass", lastObservedAt: null }, now: NOW });
  const tool = createTelemetryAiTool({ readView: async ({ principal, view, tenantId }) => {
    const hit = cache.get({ principal, tenantId, view, params: {}, now: NOW });
    return hit.data;
  }});
  const forbidden = await tool.invoke({ principal: acmeOperator, view: "ai", tenantId: "acme" });
  assert.equal(forbidden.ok, false);
  const allowed = await tool.invoke({ principal: aiOwner, view: "ai", tenantId: "acme" });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.items[0].prompt, "[REDACTED]");
});

test("en adapter med udførelsesmyndighed afvises", () => {
  assert.equal(assertReadOnly({ readOnly: true, canExecute: false }), true);
  assert.throws(() => assertReadOnly({ readOnly: true, canExecute: true }), /udførelsesmyndighed/);
});
