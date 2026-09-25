import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogLedger, LedgerError } from "../src/ledger.mjs";
import { makeLedger, makeCorrelation, sensorRecord, humanRecord } from "./support/fixture.mjs";

test("lægger poster i en append-only ledger og læser dem tenant-scopet", async () => {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  const first = await ledger.append(sensorRecord({ correlation }));
  const second = await ledger.append(humanRecord({ correlation }));
  assert.ok(first.record.ledger.seq >= 1);
  assert.ok(second.record.ledger.seq > first.record.ledger.seq);
  assert.equal(first.record.ledger.prevHash, "0".repeat(64));

  const read = await ledger.read({ tenantId: "acme" });
  assert.equal(read.length, 2);
  assert.equal(read[0].id, first.record.id);
  assert.equal(read[1].id, second.record.id);
  const none = await ledger.read({ tenantId: "globex" });
  assert.equal(none.length, 0);
});

test("ledgeren har ingen update- eller delete-metode", () => {
  const { ledger } = makeLedger();
  const caps = ledger.capabilities();
  assert.deepEqual(caps, { append: true, read: true, verify: true, update: false, delete: false });
  assert.equal(typeof ledger.update, "undefined");
  assert.equal(typeof ledger.delete, "undefined");
});

test("verificerer hash-kæde og monotone sekvenser", async () => {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  await ledger.append(sensorRecord({ correlation }));
  await ledger.append(humanRecord({ correlation }));
  const result = await ledger.verify("acme");
  assert.equal(result.ok, true);
  assert.equal(result.chain.ok, true);
  assert.equal(result.records, 2);
  assert.equal(result.streams, 1);
});

test("afviser en audit-log der ikke kan give en holdbar sekvens/hash", async () => {
  const ledger = createLogLedger({ audit: { append: async () => ({ ok: true }), events: () => [] } });
  await assert.rejects(() => ledger.append(sensorRecord({})), (err) => err instanceof LedgerError && err.code === "not_durable");
});

test("streams og head opsummerer forløbet", async () => {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  await ledger.append(sensorRecord({ correlation }));
  await ledger.append(humanRecord({ correlation }));
  const streams = await ledger.streams("acme");
  assert.equal(streams.length, 1);
  assert.equal(streams[0].stream, "acme/exec-test-1");
  assert.equal(streams[0].count, 2);
  const head = await ledger.head("acme");
  assert.equal(head.provenance, "human");
});
