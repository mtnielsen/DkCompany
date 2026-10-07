import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAccess, decideFieldAccess, assertAccess, filterRows } from "../src/index.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { PROFILES, BI_USER, HR_USER, SSO_ONLY, principal, OTHER_TENANT } from "./support/fixtures.mjs";

const dataset = (tenantId = "acme") => ({ tenantId, type: "dataset", localId: "employees" });

test("BI-bruger kan ikke læse lønfelter uden en eksplicit HR-bevilling", () => {
  const result = decideAccess({ principal: BI_USER, profile: PROFILES.bi, resource: dataset(), fields: ["salary"] });
  assert.equal(result.decision, "deny");
  assert.deepEqual(result.deniedFields, ["salary"]);
  assert.equal(result.allowedFields.length, 0);
});

test("HR-bruger uden lønbevilling nægtes, med bevilling tillades feltet", () => {
  const without = decideAccess({ principal: principal({ grants: [] }), profile: PROFILES.hr, resource: dataset(), fields: ["salary"] });
  assert.equal(without.decision, "deny");
  const withGrant = decideAccess({ principal: HR_USER, profile: PROFILES.hr, resource: dataset(), fields: ["salary", "employee_name"] });
  assert.equal(withGrant.decision, "allow");
  assert.deepEqual(withGrant.allowedFields.sort(), ["employee_name", "salary"]);
});

test("et almindeligt SSO-login er ikke bevis for downstream-autorisation", () => {
  const result = decideAccess({ principal: SSO_ONLY, profile: PROFILES.hr, resource: dataset(), fields: ["personnel_record"] });
  assert.equal(result.decision, "deny");
  assert.match(result.reasons.join(" "), /bevilling/);
});

test("tilbageholdelse returnerer feltet redact, ikke allow", () => {
  const result = decideAccess({ principal: HR_USER, profile: PROFILES.hr, resource: dataset(), fields: ["national_id"] });
  assert.equal(result.decision, "redact");
  assert.deepEqual(result.redactedFields, ["national_id"]);
});

test("default-deny: et ukendt felt nægtes", () => {
  assert.equal(decideFieldAccess({ principal: HR_USER, profile: PROFILES.bi, field: "ukendt_felt" }).decision, "deny");
});

test("en fremmed tenant afvises", () => {
  const result = decideAccess({ principal: BI_USER, profile: PROFILES.bi, resource: dataset(OTHER_TENANT), fields: ["metric"] });
  assert.equal(result.decision, "deny");
  assert.match(result.reasons.join(" "), /globex/);
});

test("principal uden tenantbinding afvises", () => {
  assert.equal(decideAccess({ principal: principal({ tenantId: null }), profile: PROFILES.bi, resource: dataset(), fields: ["metric"] }).decision, "deny");
});

test("en skrivehandling på en læseflade afvises", () => {
  assert.equal(decideAccess({ principal: HR_USER, profile: PROFILES.hr, resource: dataset(), fields: ["salary"], action: "delete" }).decision, "deny");
});

test("assertAccess kaster AuthorizationError ved afvisning", () => {
  assert.throws(() => assertAccess({ principal: BI_USER, profile: PROFILES.bi, resource: dataset(), fields: ["salary"] }), AuthorizationError);
  assert.doesNotThrow(() => assertAccess({ principal: HR_USER, profile: PROFILES.hr, resource: dataset(), fields: ["employee_name"] }));
});

test("rækkefiltrering er tenantstram og default-deny", () => {
  const rows = [
    { id: "r1", tenantId: "acme", attributes: { subject: "oidc|hr.bruger", department: "hr" } },
    { id: "r2", tenantId: "acme", attributes: { subject: "oidc|anden.bruger", department: "finance" } },
    { id: "r3", tenantId: "globex", attributes: { subject: "oidc|hr.bruger", department: "hr" } },
    { id: "r4", tenantId: "acme", attributes: { subject: "oidc|tredje.bruger", department: "hr" } },
  ];
  const visible = filterRows({ principal: HR_USER, profile: PROFILES.hr, rows }).map((r) => r.id);
  assert.deepEqual(visible.sort(), ["r1", "r4"]);
});
