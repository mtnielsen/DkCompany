/**
 * DKC-021 — end-to-end mod den rigtige stak (lager, cache, indeks, afledt AI,
 * suppressionsjournal) gennem `runDemo`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDemo } from "../src/demo.mjs";
import { loadPolicy } from "../src/registry.mjs";
import { validateDeletionReceipt } from "../../conformance/src/retention.mjs";

test("et fuldt gennemløb rapporterer dækning, hold-blokering og restore-frigivelse", () => {
  const demo = runDemo({ policy: loadPolicy() });
  try {
    assert.equal(demo.objectGone, true, "primærlageret indeholder stadig subjektets objekt");
    assert.equal(demo.receipt.status, "partial");
    assert.equal(demo.receipt.results.find((r) => r.kind === "primary").status, "full");
    assert.equal(demo.receipt.results.find((r) => r.kind === "index").status, "full");
    assert.equal(demo.receipt.results.find((r) => r.kind === "cache").status, "full");
    assert.ok(demo.receipt.summary.remainingCopies >= 1);
    assert.equal(validateDeletionReceipt(demo.receipt).ok, true, JSON.stringify(validateDeletionReceipt(demo.receipt).errors));

    assert.equal(demo.holds.blocked.status, "blocked-by-hold");
    assert.equal(demo.holds.blocked.summary.recordsAffected, 0);

    assert.equal(demo.restore.opened, true);
    assert.equal(demo.restore.applied.status, "decisions-applied");
    assert.equal(demo.restore.released.status, "released");

    const serialized = JSON.stringify(demo.audit);
    assert.ok(!serialized.includes("kunde@example.org"), "revisionssporet indeholder en rå identifikator");
  } finally {
    demo.cleanup();
  }
});
