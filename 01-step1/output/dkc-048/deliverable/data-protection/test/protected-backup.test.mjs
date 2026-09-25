import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageCluster } from "../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../storage/src/tenant-keys.mjs";
import { loadStoragePlan } from "../../storage/src/plan.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadImmutablePolicy } from "../src/enforcement.mjs";
import { exportProtectedState, importProtectedState, compareProtectedState } from "../src/protected-backup.mjs";

const plan = loadStoragePlan(repoRoot);
const policy = loadImmutablePolicy();
const NOW = Date.parse("2026-09-26T00:00:00Z");
const FAR = new Date(NOW + 10 * 365 * 24 * 3600 * 1000).toISOString();

function makeStore(prefix) {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  const store = createStorageCluster({ plan, rootDir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  return { store, rootDir, cleanup: () => rmSync(rootDir, { recursive: true, force: true }) };
}

test("backup/restore bevarer versioner, låse og adgangsregler", () => {
  const source = makeStore("dkc-048-backup-src-");
  const target = makeStore("dkc-048-backup-dst-");
  try {
    source.store.put("acme", "audit/log.bin", Buffer.from("v1"), { classification: "object-store", now: NOW });
    const second = source.store.put("acme", "audit/log.bin", Buffer.from("v2"), { classification: "object-store", now: NOW + 1000 });
    source.store.put("acme", "policy/bundle.json", Buffer.from("policy"), { classification: "object-store", now: NOW });
    source.store.lockVersion("acme", "audit/log.bin", second.version, { mode: "COMPLIANCE", retainUntil: FAR, now: NOW });

    const exported = exportProtectedState({ store: source.store, tenantId: "acme", policy, clock: () => NOW });
    assert.equal(exported.items.length, 2);

    const restored = importProtectedState({ store: target.store, state: exported, clock: () => NOW });
    const comparison = compareProtectedState(exported, restored);
    assert.equal(comparison.ok, true, JSON.stringify(comparison.problems));
    assert.equal(restored.policyPreserved, true);

    // Låsen og den autoritative version er genskabt i det nye lager.
    const authoritative = target.store.authoritative("acme", "audit/log.bin");
    assert.equal(authoritative.locked, true);
    assert.equal(authoritative.version, second.version);
    assert.equal(target.store.deleteVersion("acme", "audit/log.bin", second.version, { bypassGovernance: true, now: NOW }).reason, "compliance-locked");
  } finally {
    source.cleanup();
    target.cleanup();
  }
});

test("compareProtectedState opdager en manglende lås", () => {
  const source = makeStore("dkc-048-backup-src2-");
  const target = makeStore("dkc-048-backup-dst2-");
  try {
    const put = source.store.put("acme", "audit/log.bin", Buffer.from("v1"), { classification: "object-store", now: NOW });
    source.store.lockVersion("acme", "audit/log.bin", put.version, { mode: "COMPLIANCE", retainUntil: FAR, now: NOW });
    const exported = exportProtectedState({ store: source.store, tenantId: "acme", policy, clock: () => NOW });
    const restored = importProtectedState({ store: target.store, state: exported, clock: () => NOW });
    const tampered = { ...exported, items: exported.items.map((i) => ({ ...i, versions: i.versions.map((v) => ({ ...v, lock: null })) })) };
    const comparison = compareProtectedState(tampered, restored);
    assert.equal(comparison.ok, false);
    assert.ok(comparison.problems.some((p) => p.reason === "lock-count-mismatch"));
  } finally {
    source.cleanup();
    target.cleanup();
  }
});
