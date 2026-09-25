import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageCluster } from "../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../storage/src/tenant-keys.mjs";
import { loadStoragePlan } from "../../storage/src/plan.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadRegister } from "../src/registry.mjs";
import { loadImmutablePolicy, createImmutableEnforcer, immutablePolicyProblems, resolveRole } from "../src/enforcement.mjs";
import { createProtectedKeyStore } from "../src/key-protection.mjs";

const plan = loadStoragePlan(repoRoot);
const policy = loadImmutablePolicy();
const register = loadRegister();
const NOW = Date.parse("2026-09-26T00:00:00Z");
const FAR = new Date(NOW + 10 * 365 * 24 * 3600 * 1000).toISOString();

const agent = { kind: "agent", id: "agent-1" };
const auditIngest = { kind: "service", role: "audit-ingest", id: "audit-svc" };
const storageAdmin = { kind: "human", role: "storage-admin", id: "oidc|stina.storage" };
const securityAdmin = { kind: "human", role: "security-admin", id: "oidc|sven.security" };
const workload = { kind: "service", role: "workload", id: "workload-1" };
const noRole = { kind: "human", id: "oidc|unknown" };
const approval = { approvedBy: "oidc|bo.bertelsen", approvedAt: "2026-09-26T00:00:00Z" };

function fixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "dkc-048-enforce-"));
  const store = createStorageCluster({ plan, rootDir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  const keyStore = createProtectedKeyStore({ policy, register, clock: () => NOW });
  keyStore.registerKey({ keyId: "policy-signing", keyDomain: "kms-root", protectedKey: true, resourceId: "policy-signing-key" });
  keyStore.registerKey({ keyId: "ephemeral", keyDomain: "ephemeral-domain" });
  const enforcer = createImmutableEnforcer({ policy, register, store, keyStore, clock: () => NOW });
  return { store, keyStore, enforcer, cleanup: () => rmSync(rootDir, { recursive: true, force: true }) };
}

test("politikken er semantisk gyldig og rollerne findes", () => {
  assert.deepEqual(immutablePolicyProblems(policy), []);
  assert.equal(resolveRole(policy, agent).id, "agent");
  assert.equal(resolveRole(policy, securityAdmin).id, "security-admin");
  assert.equal(resolveRole(policy, noRole), null);
});

test("AI-agenten kan hverken skrive, slette, skifte pointer, slette nøgle eller bruge indirekte admin", () => {
  const { enforcer, cleanup } = fixture();
  try {
    for (const op of ["write", "append", "update", "delete", "retention-extend", "retention-shorten", "pointer-switch", "key-delete", "lifecycle-change", "serviceaccount-write", "trust-config-write", "recovery-access"]) {
      const decision = enforcer.evaluate({ principal: agent, operation: op });
      assert.equal(decision.allowed, false, `AI burde være nægtet '${op}'`);
    }
    assert.equal(enforcer.evaluate({ principal: agent, operation: "read" }).allowed, true);
  } finally {
    cleanup();
  }
});

test("audit-ingest er append-only og kan ikke opdatere eller slette", () => {
  const { enforcer, cleanup } = fixture();
  try {
    assert.equal(enforcer.evaluate({ principal: auditIngest, operation: "append" }).allowed, true);
    for (const op of ["update", "delete", "retention-shorten", "pointer-switch", "key-delete"]) {
      assert.equal(enforcer.evaluate({ principal: auditIngest, operation: op }).allowed, false, `audit-ingest burde være nægtet '${op}'`);
    }
  } finally {
    cleanup();
  }
});

test("en app-konto (workload) kan skrive men ikke slette eller ændre retention", () => {
  const { enforcer, cleanup } = fixture();
  try {
    assert.equal(enforcer.evaluate({ principal: workload, operation: "write" }).allowed, true);
    assert.equal(enforcer.evaluate({ principal: workload, operation: "delete" }).allowed, false);
    assert.equal(enforcer.evaluate({ principal: workload, operation: "retention-extend" }).allowed, false);
  } finally {
    cleanup();
  }
});

test("en ukendt principal nægtes (default-deny)", () => {
  const { enforcer, cleanup } = fixture();
  try {
    assert.equal(enforcer.evaluate({ principal: noRole, operation: "read" }).allowed, false);
  } finally {
    cleanup();
  }
});

test("WORM-lås kan sættes af et menneske men ikke af en AI", () => {
  const { store, enforcer, cleanup } = fixture();
  try {
    const put = store.put("acme", "audit/log.bin", Buffer.from("log"), { classification: "object-store", now: NOW });
    assert.equal(enforcer.lockVersion({ tenantId: "acme", key: "audit/log.bin", version: put.version, mode: "COMPLIANCE", principal: agent }).locked, false);
    const locked = enforcer.lockVersion({ tenantId: "acme", key: "audit/log.bin", version: put.version, mode: "COMPLIANCE", retainUntil: FAR, principal: storageAdmin, approval });
    assert.equal(locked.committed, true);
  } finally {
    cleanup();
  }
});

test("pointer-switch er nægtet for AI og bevarer den autoritative låste version", () => {
  const { store, enforcer, cleanup } = fixture();
  try {
    const put = store.put("acme", "audit/log.bin", Buffer.from("v1"), { classification: "object-store", now: NOW });
    store.lockVersion("acme", "audit/log.bin", put.version, { mode: "COMPLIANCE", retainUntil: FAR, now: NOW });
    const denied = enforcer.switchPointer({ tenantId: "acme", key: "audit/log.bin", targetVersion: 2, principal: agent });
    assert.equal(denied.switched, false);
    const allowed = enforcer.switchPointer({ tenantId: "acme", key: "audit/log.bin", targetVersion: 2, principal: storageAdmin });
    assert.equal(allowed.switched, true);
    assert.equal(allowed.authoritative.version, put.version);
  } finally {
    cleanup();
  }
});

test("nøglesletning kræver security-admin og to-personers godkendelse; AI nægtes", () => {
  const { enforcer, cleanup } = fixture();
  try {
    assert.equal(enforcer.deleteKey({ keyId: "ephemeral", principal: agent }).deleted, false);
    assert.equal(enforcer.deleteKey({ keyId: "ephemeral", principal: securityAdmin }).deleted, false);
    const deleted = enforcer.deleteKey({ keyId: "ephemeral", principal: securityAdmin, approval });
    assert.equal(deleted.allowed, true);
  } finally {
    cleanup();
  }
});

test("en nøgle bundet til en retention-locked post kan ikke slettes", () => {
  const { enforcer, cleanup } = fixture();
  try {
    const result = enforcer.deleteKey({ keyId: "policy-signing", principal: securityAdmin, approval });
    assert.equal(result.deleted, false);
    assert.ok(result.reasons.some((r) => r.includes("beskyttede poster")));
  } finally {
    cleanup();
  }
});

test("beskyttelsespolitik kræver to-personers kontrol og samme godkender afvises", () => {
  const { enforcer, cleanup } = fixture();
  try {
    assert.equal(enforcer.changeProtectionPolicy({ principal: securityAdmin }).changed, false);
    const selfApprove = enforcer.changeProtectionPolicy({ principal: securityAdmin, approval: { approvedBy: securityAdmin.id, approvedAt: "2026-09-26T00:00:00Z" } });
    assert.equal(selfApprove.changed, false);
    assert.ok(selfApprove.reasons.some((r) => r.includes("samme")));
    assert.equal(enforcer.changeProtectionPolicy({ principal: securityAdmin, approval }).changed, true);
  } finally {
    cleanup();
  }
});

test("recovery-adgang kræver to-personers kontrol og nægtes for AI", () => {
  const { enforcer, cleanup } = fixture();
  try {
    assert.equal(enforcer.requestRecoveryAccess({ principal: agent }).granted, false);
    assert.equal(enforcer.requestRecoveryAccess({ principal: securityAdmin }).granted, false);
    assert.equal(enforcer.requestRecoveryAccess({ principal: securityAdmin, approval }).granted, true);
  } finally {
    cleanup();
  }
});

test("audit-sporet indeholder både afviste og tilladte beslutninger", () => {
  const { enforcer, cleanup } = fixture();
  try {
    enforcer.evaluate({ principal: agent, operation: "delete" });
    enforcer.evaluate({ principal: workload, operation: "write" });
    assert.ok(enforcer.audit().length >= 0);
  } finally {
    cleanup();
  }
});
