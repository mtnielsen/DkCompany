import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkBuffer, joinChunks, CHUNKER_ALGORITHM } from "../src/chunker.mjs";

function payload(seed) {
  // Deterministisk, gentagende indhold med lokal variation.
  const parts = [];
  for (let i = 0; i < 4000; i += 1) parts.push(`blok-${i % 37}-${(i * seed) % 101};`);
  return Buffer.from(parts.join(""), "utf8");
}

test("chunking er deterministisk for samme indhold", () => {
  const a = chunkBuffer(payload(7));
  const b = chunkBuffer(payload(7));
  assert.deepEqual(a.map((c) => c.sha256), b.map((c) => c.sha256));
  assert.equal(CHUNKER_ALGORITHM, "gear-cdc-sha256-v1");
});

test("chunkstørrelser respekterer min/avg/max (sidste chunk kan være mindre)", () => {
  const chunks = chunkBuffer(payload(3));
  assert.ok(chunks.length > 1);
  for (const [index, chunk] of chunks.entries()) {
    if (index < chunks.length - 1) assert.ok(chunk.length >= 512, `chunk under min: ${chunk.length}`);
    assert.ok(chunk.length <= 8192, `chunk over max: ${chunk.length}`);
  }
});

test("en indsættelse i starten bevarer de fleste senere chunks", () => {
  const original = payload(11);
  const before = chunkBuffer(original);
  const mutated = Buffer.concat([Buffer.from("INSERT", "utf8"), original]);
  const after = chunkBuffer(mutated);
  const beforeSet = new Set(before.map((c) => c.sha256));
  const shared = after.filter((c) => beforeSet.has(c.sha256)).length;
  assert.ok(shared >= Math.floor(before.length / 2), `kun ${shared}/${before.length} chunks delt`);
});

test("tom input giver ingen chunks, og join genskaber bytes", () => {
  assert.deepEqual(chunkBuffer(Buffer.alloc(0)), []);
  const chunks = chunkBuffer(payload(5));
  assert.deepEqual(joinChunks(chunks), payload(5));
});

test("join afviser en chunk hvis digest er ændret", () => {
  const chunks = chunkBuffer(payload(13));
  chunks[0].buffer = Buffer.from("korrupt", "utf8");
  assert.throws(() => joinChunks(chunks), /digest/);
});

test("ugyldige chunkparametre afvises", () => {
  assert.throws(() => chunkBuffer(payload(1), { minSizeBytes: 4096, averageSizeBytes: 1024 }), /min <= gennemsnit/);
  assert.throws(() => chunkBuffer(payload(1), { minSizeBytes: 0 }), /positivt heltal/);
});
