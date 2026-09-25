import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveKey } from "../src/archive.mjs";
import { makeArchive, makeLedger, makeCorrelation, sensorRecord, tempRoot } from "./support/fixture.mjs";

test("arkiverer til uafhængige fejldomæner og WORM-låser de immutable kopier", async () => {
  const { root, cleanup } = tempRoot();
  try {
    const { archive } = makeArchive(root);
    const { ledger } = makeLedger();
    const stored = await ledger.append(sensorRecord({ correlation: makeCorrelation() }));
    const summary = await archive.archive(stored.record);
    assert.equal(summary.targets.length, 3);
    assert.equal(summary.targets.filter((t) => t.locked).length, 2);
    assert.equal(archive.failureDomains(), 3);
    assert.equal(archive.immutableDomains(), 2);

    const verified = await archive.verify(stored.record);
    assert.equal(verified.ok, true);
    assert.equal(verified.targets.length, 3);
  } finally {
    cleanup();
  }
});

test("en WORM-låst logpost kan ikke slettes af driftscredentials", async () => {
  const { root, cleanup } = tempRoot();
  try {
    const { archive, clusters } = makeArchive(root);
    const { ledger } = makeLedger();
    const stored = await ledger.append(sensorRecord({ correlation: makeCorrelation() }));
    const summary = await archive.archive(stored.record);
    const target = summary.targets.find((t) => t.id === "worm-external");
    const key = archiveKey(stored.record);
    const attempt = clusters.external.deleteVersion("acme", key, target.version);
    assert.equal(attempt.deleted, false);
    assert.equal(attempt.reason, "compliance-locked");
    const stillThere = clusters.external.get("acme", key);
    assert.equal(stillThere.version, target.version);
  } finally {
    cleanup();
  }
});

test("arkivet kan læses tilbage med samme digest", async () => {
  const { root, cleanup } = tempRoot();
  try {
    const { archive, clusters } = makeArchive(root);
    const { ledger } = makeLedger();
    const stored = await ledger.append(sensorRecord({ correlation: makeCorrelation() }));
    const summary = await archive.archive(stored.record);
    const target = summary.targets[0];
    const read = clusters.primary.get("acme", archiveKey(stored.record));
    assert.equal(read.version, target.version);
    assert.equal(read.sha256, target.sha256);
  } finally {
    cleanup();
  }
});
