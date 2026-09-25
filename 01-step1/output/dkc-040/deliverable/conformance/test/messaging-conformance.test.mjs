import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateMessagingTopology, validateOutboxRecord } from "../src/messaging.mjs";
import { repoRoot } from "../src/schemas.mjs";

const example = () => JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "messaging-topology.example.json"), "utf8"));
const clone = () => structuredClone(example());

test("det committede beskedtopologieksempel validerer med skema og semantik", () => {
  const result = validateMessagingTopology(example());
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
});

test("eksemplet er identisk med den kanoniske topologi", () => {
  const plan = JSON.parse(readFileSync(join(repoRoot, "jobs", "messaging.json"), "utf8"));
  assert.deepEqual(example(), plan);
});

test("outbox-eksemplet validerer mod kontrakten", () => {
  const data = JSON.parse(readFileSync(join(repoRoot, "contracts", "examples", "outbox-record.example.json"), "utf8"));
  const result = validateOutboxRecord(data);
  assert.equal(result.ok, true, result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
});

test("skemaet afviser en ikke-holdbar broker eller manglende publisher confirms", () => {
  const broken = clone();
  broken.broker.durable = false;
  assert.equal(validateMessagingTopology(broken).ok, false);
  const noConfirm = clone();
  noConfirm.broker.publisherConfirms = false;
  assert.equal(validateMessagingTopology(noConfirm).ok, false);
});

test("semantikken afviser quorum under flertallet og usikre writes", () => {
  const broken = clone();
  broken.broker.quorum = 1;
  assert.ok(validateMessagingTopology(broken).errors.some((e) => e.path === "/broker/quorum"));
  const unsafe = clone();
  unsafe.broker.unsafeWritesOnQuorumLoss = true;
  assert.equal(validateMessagingTopology(unsafe).ok, false);
});

test("semantikken afviser en fire-and-forget-outbox", () => {
  const broken = clone();
  broken.outbox.confirmMode = "fire-and-forget";
  assert.ok(validateMessagingTopology(broken).errors.some((e) => e.path === "/outbox/confirmMode"));
});

test("semantikken afviser en inbox uden dedup, rækkefølge eller hul-udsættelse", () => {
  const noDedup = clone();
  noDedup.inbox.dedup = "none";
  assert.equal(validateMessagingTopology(noDedup).ok, false);
  const noOrder = clone();
  noOrder.inbox.ordering = "none";
  assert.equal(validateMessagingTopology(noOrder).ok, false);
  const noDefer = clone();
  noDefer.inbox.gapPolicy = "skip";
  assert.equal(validateMessagingTopology(noDefer).ok, false);
});

test("semantikken afviser et singletonjob uden monotont fencing-token", () => {
  const broken = clone();
  broken.singletons[0].fencing = "none";
  assert.ok(validateMessagingTopology(broken).errors.some((e) => e.path === "/singletons/0/fencing"));
});

test("semantikken afviser krydskunde-forbrug og en exactly-once-påstand", () => {
  const crossTenant = clone();
  crossTenant.tenantIsolation.crossTenantConsume = true;
  assert.equal(validateMessagingTopology(crossTenant).ok, false);
  const exactlyOnce = clone();
  exactlyOnce.deliveryGuarantee = "exactly-once";
  assert.equal(validateMessagingTopology(exactlyOnce).ok, false);
});

test("semantikken afviser en usynlig køtilstand", () => {
  const broken = clone();
  broken.backpressure.visible = false;
  assert.ok(validateMessagingTopology(broken).errors.some((e) => e.path === "/backpressure/visible"));
});
