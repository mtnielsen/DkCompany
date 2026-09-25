import { test } from "node:test";
import assert from "node:assert/strict";
import { createServiceAccount, serviceAccountProblems, serviceAccountAccess, cannotImpersonate, principalForServiceAccount, isAdminCredential } from "../src/index.mjs";
import { PROFILES } from "./support/fixtures.mjs";

const owner = { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Service Owner" };

test("en gyldig servicekonto oprettes frossen med præcis én rolle", () => {
  const account = createServiceAccount({ id: "svc|reporting", tenantId: "acme", scopes: ["read:hr"], owner });
  assert.equal(account.roles.length, 1);
  assert.equal(account.roles[0], "service-account");
  assert.equal(account.interactive, false);
  assert.ok(Object.isFrozen(account));
  assert.equal(serviceAccountProblems(account).length, 0);
});

test("servicekonti med brede scopes, to roller eller interaktiv login afvises", () => {
  assert.ok(serviceAccountProblems({ id: "s", tenantId: "acme", roles: ["service-account"], scopes: ["*"], interactive: false, owner }).some((p) => /scope/.test(p.message)));
  assert.ok(serviceAccountProblems({ id: "s", tenantId: "acme", roles: ["service-account", "platform-admin"], scopes: ["read:hr"], interactive: false, owner }).length > 0);
  assert.ok(serviceAccountProblems({ id: "s", tenantId: "acme", roles: ["service-account"], scopes: ["read:hr"], interactive: true, owner }).some((p) => /interaktivt/.test(p.message)));
});

test("en servicekonto uden navngivet ejer afvises", () => {
  assert.ok(serviceAccountProblems({ id: "s", tenantId: "acme", roles: ["service-account"], scopes: ["read:hr"], interactive: false, owner: { subject: "team|sre", name: "SRE", role: "Team" } }).some((p) => /menneske/.test(p.message)));
});

test("servicekontoens scopes styrer adgangen gennem den fælles motor", () => {
  const account = createServiceAccount({ id: "svc|reporting", tenantId: "acme", scopes: ["reporting.output.read"], owner });
  const allowed = serviceAccountAccess({ serviceAccount: account, profile: PROFILES.reporting, resource: { tenantId: "acme", type: "report", localId: "r1" }, fields: ["report_output"] });
  assert.equal(allowed.decision, "allow");
  const denied = serviceAccountAccess({ serviceAccount: { ...account, scopes: [] }, profile: PROFILES.reporting, resource: { tenantId: "acme", type: "report", localId: "r1" }, fields: ["report_output"] });
  assert.equal(denied.decision, "deny");
});

test("principalen for en servicekonto er ikke-interaktiv", () => {
  const account = createServiceAccount({ id: "svc|reporting", tenantId: "acme", scopes: ["read:hr"], owner });
  assert.equal(principalForServiceAccount(account).kind, "service-account");
  assert.equal(principalForServiceAccount(account).interactive, undefined);
});

test("en servicekonto kan ikke impersonere et menneske eller bruge admin-credentials", () => {
  const account = createServiceAccount({ id: "svc|reporting", tenantId: "acme", scopes: ["read:hr"], owner });
  assert.equal(cannotImpersonate(account, { id: "oidc|hr.bruger" }), true);
  assert.equal(cannotImpersonate({ ...account, impersonates: "oidc|hr.bruger" }, { id: "oidc|hr.bruger" }), false);
  assert.equal(isAdminCredential({ roles: ["platform-admin"] }), true);
  assert.equal(isAdminCredential({ roles: ["dba"] }), true);
  assert.equal(isAdminCredential({ roles: ["service-account"] }), false);
});
