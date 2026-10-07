import { test } from "node:test";
import assert from "node:assert/strict";
import { createIngestor } from "../src/ingest.mjs";
import { createBoundedStore } from "../src/store.mjs";
import { makeEnvelope, metricEnvelope, registry, NOW, acmeOperator, globexPlatformAdmin } from "./support/fixtures.mjs";

function setup(limits = {}) {
  const store = createBoundedStore({ capacity: 100, retentionSeconds: 86400, clock: () => NOW });
  const ingestor = createIngestor({ store, registry, clock: () => NOW, limits });
  return { store, ingestor };
}

test("en gyldig envelope accepteres og får server-side scope", () => {
  const { store, ingestor } = setup();
  const result = ingestor.ingest({ principal: acmeOperator, envelope: makeEnvelope() });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "accepted");
  assert.equal(result.scope.tenantId, "acme");
  assert.equal(store.stats().size, 1);
  assert.equal(store.get("env-1").scope.environment, "staging");
});

test("et tenantpåstand der afviger fra principalen afvises", () => {
  const { store, ingestor } = setup();
  const result = ingestor.ingest({ principal: acmeOperator, envelope: makeEnvelope({ scope: { tenantId: "globex", environment: "staging" }, resource: "res://globex/service/x" }) });
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? (result.violations ?? []).join(" "), /scope kunne ikke udledes|matcher ikke/);
  assert.equal(store.stats().size, 0);
});

test("en resource der ikke matcher den udledte tenant afvises", () => {
  const { ingestor } = setup();
  const result = ingestor.ingest({ principal: acmeOperator, envelope: makeEnvelope({ resource: "res://globex/service/x", relations: { environment: "res://platform/environment/staging", trace: "res://globex/trace/0123456789abcdef0123456789abcdef" } }) });
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? (result.violations ?? []).join(" "), /tilhører ikke den udledte tenant/);
});

test("en scopet platformrolle kan indtage for en anden tenant", () => {
  const { store, ingestor } = setup();
  const envelope = makeEnvelope({ id: "globex-env", scope: { tenantId: "globex", environment: "staging" }, resource: "res://globex/service/x" });
  const result = ingestor.ingest({ principal: globexPlatformAdmin, envelope });
  assert.equal(result.accepted, true);
  assert.equal(result.scope.tenantId, "globex");
  assert.equal(store.query({ tenantId: "globex" }).count, 1);
});

test("en utroværdig kilde afvises", () => {
  const { ingestor } = setup();
  const result = ingestor.ingest({ principal: acmeOperator, envelope: makeEnvelope({ source: { id: "fraud", kind: "otel" } }) });
  assert.equal(result.accepted, false);
  assert.ok(result.violations.some((v) => /ikke registreret som betroet/.test(v)));
});

test("dubletter og replays håndteres forskelligt", () => {
  const { store, ingestor } = setup();
  const envelope = makeEnvelope();
  assert.equal(ingestor.ingest({ principal: acmeOperator, envelope }).status, "accepted");
  assert.equal(ingestor.ingest({ principal: acmeOperator, envelope }).status, "duplicate");
  const tampered = makeEnvelope({ otel: { metric: { name: "http_requests_total", value: 999 } } });
  const replay = ingestor.ingest({ principal: acmeOperator, envelope: tampered });
  assert.equal(replay.accepted, false);
  assert.match(replay.reason, /replay/);
  assert.equal(store.stats().size, 1);
});

test("forældede hændelser accepteres som late og markeres", () => {
  const { store, ingestor } = setup();
  const envelope = makeEnvelope({ id: "late-1", occurredAt: new Date(NOW - 2 * 3600 * 1000).toISOString() });
  const result = ingestor.ingest({ principal: acmeOperator, envelope });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "accepted-late");
  assert.equal(store.get("late-1").late, true);
  assert.equal(ingestor.stats().late, 1);
});

test("backpressure når indtagsraten overstiger grænsen", () => {
  const { ingestor } = setup({ maxEnvelopesPerSecond: 1, rateWindowSeconds: 1 });
  assert.equal(ingestor.ingest({ principal: acmeOperator, envelope: makeEnvelope({ id: "b1" }) }).accepted, true);
  const second = ingestor.ingest({ principal: acmeOperator, envelope: makeEnvelope({ id: "b2", otel: { metric: { name: "http_requests_total", value: 2 } } }) });
  assert.equal(second.status, "backpressure");
  assert.equal(second.accepted, false);
  assert.equal(ingestor.stats().backpressure, 1);
});

test("kardinalitetsgrænsen i lageret videregives", () => {
  const store = createBoundedStore({ capacity: 100, maxCardinality: 1, retentionSeconds: 86400, clock: () => NOW });
  const ingestor = createIngestor({ store, registry, clock: () => NOW });
  assert.equal(ingestor.ingest({ principal: acmeOperator, envelope: metricEnvelope("http_requests_total", 1, { labels: { status: "200" } }) }).accepted, true);
  const second = ingestor.ingest({ principal: acmeOperator, envelope: metricEnvelope("http_requests_total", 2, { labels: { status: "500" }, id: "m-500" }) });
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "cardinality");
  assert.equal(ingestor.stats().cardinality, 1);
});
