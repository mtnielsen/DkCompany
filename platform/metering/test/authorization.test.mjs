import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, REPORT_GENERATED_AT } from "../src/model.mjs";
import { buildCostReport } from "../src/report.mjs";
import { authorizeCostExport, exportCostReport } from "../src/authorization.mjs";

const all = loadAll(repoRoot);
const { report } = buildCostReport({ ...all, generatedAt: REPORT_GENERATED_AT });

test("en kunde med læserollen kan eksportere sin egen rapport", () => {
  const result = exportCostReport({ report, principal: { kind: "human", id: "u1", tenantId: "globex", roles: ["billing-reader"] } });
  assert.equal(result.tenantId, "globex");
  assert.ok(result.tenants.every((t) => t.tenantId === "globex"));
});

test("en kunde uden læserollen afvises", () => {
  assert.throws(
    () => authorizeCostExport({ principal: { kind: "human", id: "u2", tenantId: "globex", roles: ["employee"] } }),
    (e) => e.code === "cost_export_forbidden"
  );
});

test("en kunde kan ikke eksportere en fremmed tenant", () => {
  assert.throws(
    () => exportCostReport({ report, principal: { kind: "human", id: "u1", tenantId: "globex", roles: ["billing-reader"] }, requestedTenantId: "acme" }),
    /matcher ikke|tenant/
  );
});

test("en uscopet platformrolle afvises", () => {
  assert.throws(
    () => authorizeCostExport({ principal: { kind: "service", id: "svc", roles: ["platform-admin"] }, requestedTenantId: "acme" }),
    (e) => e.code === "tenant_forbidden"
  );
});

test("en scopet platformrolle kan eksportere den valgte tenant", () => {
  const result = exportCostReport({ report, principal: { kind: "service", id: "svc", roles: ["platform-admin:acme"] }, requestedTenantId: "acme" });
  assert.equal(result.crossTenant, true);
  assert.ok(result.tenants.every((t) => t.tenantId === "acme"));
});
