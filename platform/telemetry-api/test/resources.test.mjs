import { test } from "node:test";
import assert from "node:assert/strict";
import { resource, tenantOf, typeOf, isGlobal, assertRelation, buildCorrelation, mergeCorrelations, resourcesForTenant } from "../src/resources.mjs";

test("resource bygger en stabil ressource-ID med tenant og type", () => {
  const r = resource({ tenantId: "acme", type: "service", localId: "dummy-ok" });
  assert.equal(r.id, "res://acme/service/dummy-ok");
  assert.equal(tenantOf(r.id), "acme");
  assert.equal(typeOf(r.id), "service");
  assert.equal(isGlobal(r.id), false);
  assert.equal(isGlobal("res://platform/environment/staging"), true);
  assert.throws(() => resource({ tenantId: "acme", type: "vilkårlig", localId: "x" }), /ukendt ressourcetype/);
});

test("en relation må ikke krydse tenant, men må pege på en global ressource", () => {
  assert.doesNotThrow(() => assertRelation("res://acme/service/x", "trace", "res://acme/trace/1"));
  assert.doesNotThrow(() => assertRelation("res://acme/service/x", "environment", "res://platform/environment/staging"));
  assert.throws(() => assertRelation("res://acme/service/x", "incident", "res://globex/incident/1"), /krydser tenant/);
  assert.throws(() => assertRelation("res://acme/service/x", "ukendt", "res://acme/service/y"), /ukendt relation/);
});

test("buildCorrelation giver noder og kanter og markerer global krydsning", () => {
  const graph = buildCorrelation({
    root: "res://acme/service/dummy-ok",
    relations: { environment: "res://platform/environment/staging", version: "res://acme/version/1.4.2", trace: "res://acme/trace/abc" },
  });
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.edges.find((e) => e.relation === "environment").crossesTenantToGlobal, true);
  assert.equal(graph.edges.find((e) => e.relation === "version").crossesTenantToGlobal, false);
});

test("mergeCorrelations slår grafer sammen uden dubletter", () => {
  const a = buildCorrelation({ root: "res://acme/service/x", relations: { incident: "res://acme/incident/1" } });
  const b = buildCorrelation({ root: "res://acme/incident/1", relations: { alert: "res://acme/alert/1" } });
  const merged = mergeCorrelations(a, b);
  assert.equal(merged.nodes.length, 3);
  assert.equal(merged.edges.length, 2);
  assert.equal(resourcesForTenant(merged, "acme").length, 3);
  assert.equal(resourcesForTenant(merged, "globex").length, 0);
});
