import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBoundedStore } from "../src/store.mjs";

const NOW = Date.parse("2025-09-01T10:00:00Z");
const rec = (id, { at = NOW, tenantId = "acme", name = "http_requests_total", labels = {} } = {}) => ({
  id,
  occurredAt: new Date(at).toISOString(),
  scope: { tenantId },
  signal: "metric",
  labels,
  otel: { metric: { name, value: 1 } },
});

test("kapaciteten håndhæves og ældste hændelser droppes", () => {
  const store = createBoundedStore({ capacity: 3, retentionSeconds: 86400, clock: () => NOW });
  for (let i = 0; i < 5; i++) store.append(rec(`e${i}`, { at: NOW + i * 1000 }));
  const stats = store.stats();
  assert.equal(stats.size, 3);
  assert.equal(stats.dropped, 2);
  assert.equal(stats.newest, new Date(NOW + 4000).toISOString());
});

test("retention fjerner hændelser uden for vinduet", () => {
  const store = createBoundedStore({ capacity: 100, retentionSeconds: 60, clock: () => NOW });
  store.append(rec("old", { at: NOW - 120000 }));
  const result = store.append(rec("new", { at: NOW }));
  assert.equal(result.stored, true);
  assert.equal(store.stats().expired, 1);
  assert.equal(store.stats().size, 1);
});

test("kardinalitetsgrænsen dropper nye label-sæt", () => {
  const store = createBoundedStore({ capacity: 100, maxCardinality: 2, retentionSeconds: 86400, clock: () => NOW });
  assert.equal(store.append(rec("a", { labels: { status: "200" } })).stored, true);
  assert.equal(store.append(rec("b", { labels: { status: "500" } })).stored, true);
  const third = store.append(rec("c", { labels: { status: "404" } }));
  assert.equal(third.stored, false);
  assert.equal(third.reason, "cardinality");
  assert.equal(store.stats().cardinalityDropped, 1);
  // Samme label-sæt er stadig tilladt.
  assert.equal(store.append(rec("d", { labels: { status: "200" } })).stored, true);
});

test("query er tenant-scopet og pagineret med en stabil cursor", () => {
  const store = createBoundedStore({ capacity: 100, retentionSeconds: 86400, clock: () => NOW });
  for (let i = 0; i < 5; i++) store.append(rec(`acme-${i}`, { at: NOW + i * 1000 }));
  store.append(rec("globex-1", { tenantId: "globex" }));
  const page1 = store.query({ tenantId: "acme", limit: 2 });
  assert.equal(page1.count, 2);
  assert.ok(page1.items.every((r) => r.scope.tenantId === "acme"));
  const page2 = store.query({ tenantId: "acme", limit: 2, cursor: page1.nextCursor });
  assert.equal(page2.count, 2);
  assert.notEqual(page1.items[0].id, page2.items[0].id);
  assert.equal(store.query({ tenantId: "globex", limit: 10 }).count, 1);
});

test("lageret kan persistere og genindlæse seneste vindue", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-ta-store-"));
  const path = join(dir, "telemetry.ndjson");
  try {
    const store = createBoundedStore({ capacity: 10, retentionSeconds: 86400, persistPath: path, clock: () => NOW });
    store.append(rec("persist-1", { at: NOW }));
    assert.ok(existsSync(path));
    assert.ok(statSync(path).size > 0);
    const reopened = createBoundedStore({ capacity: 10, retentionSeconds: 86400, persistPath: path, clock: () => NOW });
    assert.equal(reopened.stats().size, 1);
    assert.equal(reopened.get("persist-1").id, "persist-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
