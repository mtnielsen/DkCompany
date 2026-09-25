import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryIdempotencyStore, createDurableIdempotencyStore } from "../src/idempotency.mjs";
import { openDatabase, createMigrator } from "../../persistence/src/index.mjs";

function exercise(store, label) {
  const first = store.claim({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k1", request: { a: 1 } });
  assert.equal(first.status, "new", label);
  store.complete({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k1", response: { result: "slettet" } });
  const replay = store.claim({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k1", request: { a: 1 } });
  assert.equal(replay.status, "replay", label);
  assert.deepEqual(replay.record.response, { result: "slettet" }, label);
  const conflict = store.claim({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k1", request: { a: 2 } });
  assert.equal(conflict.status, "conflict", label);
  // Tenant-isolation: samme nøgle hos en anden kunde er en anden post.
  const otherTenant = store.claim({ tenantId: "globex", scope: "s:erase", idempotencyKey: "k1", request: { a: 1 } });
  assert.equal(otherTenant.status, "new", label);
}

test("in-memory idempotens: new/replay/conflict og tenant-isolation", () => {
  exercise(createMemoryIdempotencyStore(), "memory");
});

test("holdbar idempotens overlever genstart og deler semantik med memory-storen", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-adapter-idem-"));
  const path = join(dir, "platform.db");
  try {
    let db = openDatabase({ path });
    createMigrator({ db }).apply();
    exercise(createDurableIdempotencyStore({ db }), "durable");
    db.close();

    // Genåbn: kvitteringen skal stadig være der, og en gentaget nøgle replayes.
    db = openDatabase({ path });
    const store = createDurableIdempotencyStore({ db });
    const replay = store.claim({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k1", request: { a: 1 } });
    assert.equal(replay.status, "replay");
    assert.deepEqual(replay.record.response, { result: "slettet" });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("et fejlet forsøg kan genoptages med samme nøgle og indhold", () => {
  const store = createMemoryIdempotencyStore();
  store.claim({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k2", request: { a: 1 } });
  store.fail({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k2", error: "upstream nede" });
  const retry = store.claim({ tenantId: "acme", scope: "s:erase", idempotencyKey: "k2", request: { a: 1 } });
  assert.equal(retry.status, "new");
  assert.equal(retry.record.state, "in-progress");
});
