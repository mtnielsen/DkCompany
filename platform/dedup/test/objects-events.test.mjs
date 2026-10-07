import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCloudEvent } from "../../jobs/src/events.mjs";
import { loadDedupPolicy } from "../src/policy.mjs";
import { createDedupStore } from "../src/store.mjs";
import { createDedupKeyRing, deriveTestKeyRing } from "../src/keys.mjs";
import { assertStorageDedupAllowed, planPrimaryObjectDedup, deduplicatePrimaryObject, storeBusinessRecord } from "../src/objects.mjs";
import { createEventDeduper, eventDedupKey } from "../src/events.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-dedup-obj-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("storage-dedup afviser forretningsposter og indholds-dedup af hændelser", () => {
  assert.throws(() => assertStorageDedupAllowed("business-records"), /aldrig flette forretningsposter/);
  assert.throws(() => assertStorageDedupAllowed("job-events"), /idempotency-nøgle/);
  assert.equal(assertStorageDedupAllowed("backup-blocks"), true);
});

test("primær dedup er slået fra som standard og kræver validering", () => {
  const policy = loadDedupPolicy(repoRoot);
  const plan = planPrimaryObjectDedup(policy);
  assert.equal(plan.enabled, false);
  assert.equal(plan.reason, "slået-fra-som-standard");
  const dir = mkdtempSync(join(tmpdir(), "dkc-dedup-obj-"));
  try {
    const store = createDedupStore({ rootDir: dir, keyRing: createDedupKeyRing(deriveTestKeyRing()) });
    assert.throws(
      () => deduplicatePrimaryObject({ store, policy, domain: { tenantId: "acme", encryptionDomain: "eu-primary", retentionClass: "p7d" }, objectId: "obj-1", buffer: Buffer.from("x"), validation: { integrityOk: true, restoreOk: true } }),
      /ikke aktiveret/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("primær dedup kræver både integritet, restore og menneskelig godkendelse når den er slået til", () => {
  const policy = loadDedupPolicy(repoRoot);
  policy.domains.find((d) => d.category === "primary-objects").enabled = true;
  const plan = planPrimaryObjectDedup(policy);
  assert.equal(plan.enabled, true);
  const dir = mkdtempSync(join(tmpdir(), "dkc-dedup-obj-"));
  try {
    const store = createDedupStore({ rootDir: dir, keyRing: createDedupKeyRing(deriveTestKeyRing()) });
    const domain = { tenantId: "acme", encryptionDomain: "eu-primary", retentionClass: "p7d" };
    assert.throws(() => deduplicatePrimaryObject({ store, policy, domain, objectId: "obj-1", buffer: Buffer.from("x"), validation: { integrityOk: false, restoreOk: true }, approvedBy: "anna" }), /integritets- og restoretest/);
    assert.throws(() => deduplicatePrimaryObject({ store, policy, domain, objectId: "obj-1", buffer: Buffer.from("x"), validation: { integrityOk: true, restoreOk: true }, approvedBy: null }), /menneskelig godkendelse/);
    const stored = deduplicatePrimaryObject({ store, policy, domain, objectId: "obj-1", buffer: Buffer.from("x"), validation: { integrityOk: true, restoreOk: true }, approvedBy: "oidc|anna.andersen" });
    assert.equal(stored.snapshotId, "obj-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("to identiske forretningsposter forbliver to poster uden delt reference", () => {
  const { dir, cleanup } = workDir();
  try {
    const store = createDedupStore({ rootDir: join(dir, "dedup"), keyRing: createDedupKeyRing(deriveTestKeyRing()) });
    const payload = Buffer.from(JSON.stringify({ customer: "acme", invoice: "42", amount: 1000 }));
    const first = storeBusinessRecord({ rootDir: join(dir, "records"), tenantId: "acme", recordId: "invoice-1", buffer: payload });
    const second = storeBusinessRecord({ rootDir: join(dir, "records"), tenantId: "acme", recordId: "invoice-2", buffer: payload });
    assert.equal(first.deduplicated, false);
    assert.equal(second.deduplicated, false);
    assert.notEqual(first.ref, second.ref);
    assert.deepEqual(readFileSync(join(dir, "records", first.ref)), payload);
    assert.deepEqual(readFileSync(join(dir, "records", second.ref)), payload);
    // Storage-dedup-lageret må ikke kende forretningsposter.
    assert.deepEqual(store.listSnapshots({ domain: { tenantId: "acme", encryptionDomain: "eu-primary", retentionClass: "p7d", category: "business-records" } }), []);
    assert.equal(existsSync(join(dir, "dedup", "chunks")), false);
  } finally {
    cleanup();
  }
});

test("jobhændelser deduplikeres kun på idempotency-nøglen, ikke på indhold", () => {
  const deduper = createEventDeduper({ windowSeconds: 3600, clock: () => 0 });
  const base = { tenantId: "acme", type: "job.completed", source: "runner", resource: { type: "job", id: "job-1", version: 2 }, traceId: "trace-1", principal: { kind: "workload", id: "runner-1" }, data: { result: "ok" } };
  const first = buildCloudEvent({ ...base, id: "evt-1" });
  const second = buildCloudEvent({ ...base, id: "evt-2" });
  assert.notEqual(eventDedupKey(first), eventDedupKey(second));
  assert.equal(deduper.decide(first).deliver, true);
  assert.equal(deduper.decide(second).deliver, true, "samme indhold med nyt id er en ny hændelse");
  const replay = deduper.decide(buildCloudEvent({ ...base, id: "evt-1" }));
  assert.equal(replay.deliver, false);
  assert.equal(replay.duplicate, true);
});

test("dedup-vinduet udløber, så en sen genlevering ikke undertrykkes for evigt", () => {
  let now = 0;
  const deduper = createEventDeduper({ windowSeconds: 60, clock: () => now });
  const event = buildCloudEvent({ tenantId: "acme", id: "evt-1", type: "job.completed", source: "runner", resource: { type: "job", id: "job-1", version: 1 }, traceId: "t", principal: { kind: "workload", id: "w" } });
  assert.equal(deduper.decide(event).deliver, true);
  now = 61_000;
  assert.equal(deduper.decide(event).deliver, true);
});
