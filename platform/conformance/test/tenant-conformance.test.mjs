/**
 * DKC-006 — konformanstest for tenant-kontekst og ressource-ID-kontrakten.
 *
 * Testene efterprøver de fire acceptkriterier på kontraktniveau:
 *   1. to kunder med identiske lokale id'er kan ikke blande data
 *   2. udskiftning af tenant i URL/header/body giver afvisning
 *   3. baggrundsjob og eksport bevarer tenant
 *   4. API, UI-backend og datalager er dækket (i de respektive pakkers tests)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractsDir } from "../src/schemas.mjs";
import { tenantContextProblems, validateTenantContext, validateTenantDir } from "../src/tenant.mjs";
import { formatResourceId, parseResourceId, resolveTenantContext } from "../../identity/src/tenant.mjs";

const example = JSON.parse(readFileSync(join(contractsDir, "examples/tenant-context.example.json"), "utf8"));
const clone = () => structuredClone(example);
const examplesDir = join(contractsDir, "examples");

test("eksemplet er en gyldig tenant-kontekst", () => {
  const result = validateTenantContext(clone());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(validateTenantDir(examplesDir).map((r) => r.ok), [true]);
});

test("ressource-ID med fremmed tenant afvises", () => {
  const data = clone();
  data.resources = ["res://globex/invoice/42"];
  assert.ok(tenantContextProblems(data).some((e) => /globex/.test(e.message)));
});

test("tenant-påstand der ikke matcher konteksten afvises", () => {
  const data = clone();
  data.claims = ["globex"];
  assert.ok(tenantContextProblems(data).some((e) => /matcher ikke/.test(e.message)));
});

test("krydskunde-adgang kræver særskilt rolle og eksplicit scope", () => {
  const noRole = clone();
  noRole.crossTenant = true;
  noRole.scope = ["globex"];
  assert.ok(tenantContextProblems(noRole).some((e) => /platformrolle/.test(e.message)));

  const badScope = clone();
  badScope.crossTenant = true;
  badScope.platformRole = "platform-admin";
  badScope.scope = ["other-tenant"];
  assert.ok(tenantContextProblems(badScope).some((e) => /dækker ikke/.test(e.message)));

  const ok = clone();
  ok.crossTenant = true;
  ok.platformRole = "platform-admin";
  ok.scope = ["acme"];
  assert.deepEqual(tenantContextProblems(ok), []);
});

test("egen kunde må ikke have en fremmed scope", () => {
  const data = clone();
  data.scope = ["acme", "globex"];
  assert.ok(tenantContextProblems(data).some((e) => /fremmede kunder/.test(e.message)));
});

test("demo-shim afvises som produktionskontekst", () => {
  const data = clone();
  data.source = "demo-shim";
  assert.ok(tenantContextProblems(data).some((e) => /testprofil/.test(e.message)));
});

test("to kunder med identiske lokale id'er får forskellige ressource-ID'er", () => {
  const a = formatResourceId({ tenantId: "acme", type: "invoice", localId: "42" });
  const b = formatResourceId({ tenantId: "globex", type: "invoice", localId: "42" });
  assert.notEqual(a, b);
  assert.equal(parseResourceId(a).localId, parseResourceId(b).localId);
  assert.notEqual(parseResourceId(a).tenantId, parseResourceId(b).tenantId);
});

test("runtime-konteksten afviser tenant-swap og accepterer samme tenant", () => {
  const principal = { kind: "human", id: "oidc|u", tenantId: "acme" };
  assert.equal(resolveTenantContext({ principal, claimed: ["acme"] }).tenantId, "acme");
  assert.throws(() => resolveTenantContext({ principal, claimed: ["globex"], source: "body.tenantId" }), (e) => e.code === "tenant_mismatch");
});
