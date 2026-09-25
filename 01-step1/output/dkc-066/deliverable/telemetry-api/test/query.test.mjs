import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoundedStore } from "../src/store.mjs";
import { createIngestor } from "../src/ingest.mjs";
import { createQueryService } from "../src/query.mjs";
import { metricEnvelope, registry, NOW, acmeOperator, globexPlatformAdmin } from "./support/fixtures.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";

function setup() {
  const store = createBoundedStore({ capacity: 100, retentionSeconds: 86400, clock: () => NOW });
  const ingestor = createIngestor({ store, registry, clock: () => NOW });
  for (const [name, value] of [["http_requests_total", 1000], ["http_errors_total", 2], ["http_request_duration_p95_seconds", 0.3]]) {
    ingestor.ingest({ principal: acmeOperator, envelope: metricEnvelope(name, value, { id: `${name}-1` }) });
  }
  ingestor.ingest({ principal: globexPlatformAdmin, envelope: metricEnvelope("http_requests_total", 50, { tenantId: "globex", id: "globex-metric" }) });
  const query = createQueryService({ store, clock: () => NOW });
  return { store, query };
}

test("readView er tenant-scopet og genbruger cachen", () => {
  const { query } = setup();
  const first = query.readView({ principal: acmeOperator, view: "operations", now: NOW });
  assert.equal(first.scope.tenantId, "acme");
  assert.equal(first.cached, false);
  assert.equal(first.status, "pass");
  const second = query.readView({ principal: acmeOperator, view: "operations", now: NOW });
  assert.equal(second.cached, true);
});

test("en kunde kan ikke læse en andens view", () => {
  const { query } = setup();
  assert.throws(() => query.readView({ principal: acmeOperator, view: "operations", tenantId: "globex", now: NOW }), AuthorizationError);
  const cross = query.readView({ principal: globexPlatformAdmin, view: "operations", tenantId: "globex", now: NOW });
  assert.equal(cross.scope.tenantId, "globex");
  assert.equal(cross.crossTenant, true);
});

test("readRecords er pagineret og tenant-scopet", () => {
  const { query } = setup();
  const page = query.readRecords({ principal: acmeOperator, limit: 2 });
  assert.equal(page.tenantId, "acme");
  assert.equal(page.count, 2);
  assert.ok(page.items.every((r) => r.scope.tenantId === "acme"));
  const next = query.readRecords({ principal: acmeOperator, limit: 2, cursor: page.nextCursor });
  assert.equal(next.count, 1);
});

test("eksport afvises på tværs af kunder og bærer digest", () => {
  const { query } = setup();
  const exported = query.exportView({ principal: acmeOperator, view: "operations", now: NOW });
  assert.equal(exported.tenantId, "acme");
  assert.match(exported.sha256, /^[a-f0-9]{64}$/);
  assert.ok(exported.content.includes("acme"));
  assert.throws(() => query.exportView({ principal: acmeOperator, view: "operations", tenantId: "globex", now: NOW }), AuthorizationError);
});

test("link-/ressourceopslag respekterer tenantgrænsen", () => {
  const { query } = setup();
  assert.doesNotThrow(() => query.resolveLink({ principal: acmeOperator, resourceId: "res://acme/service/dummy-ok" }));
  assert.throws(() => query.resolveLink({ principal: acmeOperator, resourceId: "res://globex/service/dummy-ok" }), AuthorizationError);
});

test("ukendte views afvises", () => {
  const { query } = setup();
  assert.throws(() => query.readView({ principal: acmeOperator, view: "hemmelig", now: NOW }), /ukendt view/);
});
