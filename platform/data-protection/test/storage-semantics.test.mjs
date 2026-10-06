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
import { verifyStorageSemantics } from "../src/storage-semantics.mjs";

const plan = loadStoragePlan(repoRoot);
const policy = loadImmutablePolicy();
const NOW = Date.parse("2026-09-26T00:00:00Z");

function fixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "dkc-048-semantics-"));
  const store = createStorageCluster({ plan, rootDir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
  return { store, cleanup: () => rmSync(rootDir, { recursive: true, force: true }) };
}

test("storage-semantikken består de negative håndhævelsestests", () => {
  const { store, cleanup } = fixture();
  try {
    const result = verifyStorageSemantics({ store, policy, now: NOW });
    assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => !c.ok)));
    assert.equal(result.verifiedByHuman, false);
    assert.equal(result.requiresLiveVerification, true);
    for (const c of result.checks) assert.equal(c.ok, true, `check '${c.id}' fejlede`);
  } finally {
    cleanup();
  }
});

test("verifikationen dækker compliance, governance, retention og versionsskjul", () => {
  const { store, cleanup } = fixture();
  try {
    const result = verifyStorageSemantics({ store, policy, now: NOW });
    const ids = result.checks.map((c) => c.id);
    for (const id of ["delete-compliance-locked", "shorten-retention", "new-version-does-not-hide-locked", "governance-bypass-requires-flag", "compliance-non-bypassable"]) {
      assert.ok(ids.includes(id), `manglende check '${id}'`);
    }
  } finally {
    cleanup();
  }
});
