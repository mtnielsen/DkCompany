import { test } from "node:test";
import assert from "node:assert/strict";
import { assertBackupAuthorization, BackupAuthorizationError, createBackupAuthorizer } from "../src/authz.mjs";

const OPERATOR = { kind: "human", id: "oidc|ops.anna", tenantId: "acme", roles: ["backup-operator"] };
const OFFICER = { kind: "human", id: "oidc|cont.officer", tenantId: "acme", roles: ["continuity-officer"] };
const APPROVER = { kind: "human", id: "oidc|approver.bob", tenantId: "acme", roles: ["continuity-officer"] };

test("backup kræver et verificeret menneske med den rette rolle", () => {
  const authorizer = createBackupAuthorizer();
  assert.equal(authorizer.authorize({ principal: OPERATOR, tenantId: "acme", action: "backup" }).allowed, true);

  const cases = [
    [{ principal: null }, /principal/],
    [{ principal: { ...OPERATOR, kind: "agent" } }, /menneske/],
    [{ principal: { ...OPERATOR, demo: true } }, /demo/],
    [{ principal: { ...OPERATOR, tenantId: "globex" } }, /tenant/],
    [{ principal: { kind: "human", id: "x", tenantId: "acme", roles: ["viewer"] } }, /rolle/],
  ];
  for (const [input, pattern] of cases) {
    const decision = authorizer.authorize({ tenantId: "acme", action: "backup", ...input });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, pattern);
  }
});

test("gendannelse kræver to-personers-godkendelse", () => {
  const authorizer = createBackupAuthorizer();
  const backupId = "0f7d2a44-2b1c-4e5d-9a3f-6c8b1d2e4f50";

  assert.equal(authorizer.authorize({ principal: OFFICER, tenantId: "acme", action: "restore", backupId }).allowed, false);
  assert.equal(
    authorizer.authorize({ principal: OFFICER, tenantId: "acme", action: "restore", backupId, approval: { backupId, approvedBy: "oidc|cont.officer", approvedAt: "2026-09-23T08:00:00Z" } }).allowed,
    false,
    "samme person må ikke godkende og udføre"
  );
  assert.equal(
    authorizer.authorize({ principal: OFFICER, tenantId: "acme", action: "restore", backupId, approval: { backupId: "andet", approvedBy: "oidc|approver.bob", approvedAt: "2026-09-23T08:00:00Z" } }).allowed,
    false,
    "godkendelsen skal være bundet til backup-id'et"
  );
  assert.equal(
    authorizer.authorize({ principal: OFFICER, tenantId: "acme", action: "restore", backupId, approval: { backupId, approvedBy: "oidc|approver.bob", approvedAt: "2026-09-23T08:00:00Z" } }).allowed,
    true
  );
});

test("assertBackupAuthorization kaster med kode", () => {
  const authorizer = createBackupAuthorizer();
  assert.throws(
    () => assertBackupAuthorization({ principal: { kind: "agent", id: "a", tenantId: "acme" }, tenantId: "acme" }, authorizer),
    (err) => err instanceof BackupAuthorizationError && err.code === "human_required"
  );
});
