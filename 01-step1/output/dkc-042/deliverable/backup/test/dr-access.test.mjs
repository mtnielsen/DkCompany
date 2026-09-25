import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStorageCluster } from "../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../storage/src/tenant-keys.mjs";
import { loadStoragePlan } from "../../storage/src/plan.mjs";
import { createRecoveryAccessGate } from "../src/dr/access.mjs";
import { loadRecoveryAccessProfile } from "../src/dr/plan.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const profile = loadRecoveryAccessProfile(repoRoot);
const APPROVAL = {
  approver1: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" },
  approver2: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Security Owner" },
};

function withCluster(fn) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-dr-access-"));
  const cluster = createStorageCluster({ plan: loadStoragePlan(repoRoot), rootDir: dir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  try {
    return fn(cluster);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("primærklyngens driftscredentials nægtes sletning af en beskyttet backup", () => {
  withCluster((cluster) => {
    const gate = createRecoveryAccessGate({ profile, storage: cluster });
    const put = cluster.put("acme", "backups/protected.enc", Buffer.from("hemmelig-backup"), { classification: "authoritative" });
    cluster.lockVersion("acme", "backups/protected.enc", put.version, { mode: "COMPLIANCE", retainUntil: new Date(Date.now() + 86_400_000).toISOString() });
    const decision = gate.deleteProtectedBackup({
      principal: { subject: "service:primary-ops", roleId: profile.primaryOperations.roleId, credentialsRef: profile.primaryOperations.credentialsRef },
      tenantId: "acme",
      key: "backups/protected.enc",
      version: put.version,
      copy: { deletePermission: "governance-two-person" },
      approval: APPROVAL,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "primary_operations_forbidden");
    assert.equal(decision.deleted, false);
    const stillThere = cluster.versions("acme", "backups/protected.enc").some((v) => v.version === put.version);
    assert.equal(stillThere, true, "lageret må ikke være rørt af et nægtet forsøg");
  });
});

test("selv en tilladt sletning stoppes mekanisk af COMPLIANCE-låsen", () => {
  withCluster((cluster) => {
    const gate = createRecoveryAccessGate({ profile, storage: cluster });
    const put = cluster.put("acme", "backups/locked.enc", Buffer.from("hemmelig-backup"), { classification: "authoritative" });
    cluster.lockVersion("acme", "backups/locked.enc", put.version, { mode: "COMPLIANCE", retainUntil: new Date(Date.now() + 86_400_000).toISOString() });
    const decision = gate.deleteProtectedBackup({
      principal: { subject: "oidc|cont.officer", kind: "human", roleId: "continuity-officer", roles: ["continuity-officer"] },
      tenantId: "acme",
      key: "backups/locked.enc",
      version: put.version,
      copy: { deletePermission: "governance-two-person" },
      approval: APPROVAL,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.deleted, false, "COMPLIANCE-låsen skal afvise sletningen");
    assert.equal(decision.storage.reason, "compliance-locked");
  });
});

test("en beskyttet backup kræver to forskellige, navngivne godkendere", () => {
  const gate = createRecoveryAccessGate({ profile });
  const recovery = { subject: "oidc|cont.officer", kind: "human", roleId: "continuity-officer", roles: ["continuity-officer"] };
  assert.equal(gate.authorizeProtectedBackupDelete({ principal: recovery }).code, "approval_required");
  assert.equal(
    gate.authorizeProtectedBackupDelete({ principal: recovery, approval: { approver1: APPROVAL.approver1, approver2: APPROVAL.approver1 } }).code,
    "separation_of_duties"
  );
  assert.equal(gate.authorizeProtectedBackupDelete({ principal: recovery, approval: APPROVAL }).allowed, true);
});

test("recovery-aktivering kræver et verificeret menneske og to godkendere", () => {
  const gate = createRecoveryAccessGate({ profile });
  assert.equal(gate.authorizeActivation({ principal: { subject: "svc", kind: "service", roleId: "continuity-officer" } }).code, "human_required");
  assert.equal(gate.authorizeActivation({ principal: { subject: "oidc|cont.officer", kind: "human", roleId: "continuity-officer" } }).code, "approval_required");
  const allowed = gate.authorizeActivation({ principal: { subject: "oidc|cont.officer", kind: "human", roleId: "continuity-officer" }, approval: APPROVAL });
  assert.equal(allowed.allowed, true);
  assert.ok(allowed.obligations.some((o) => o.startsWith("time-boxed:")));
});
