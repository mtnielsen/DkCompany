/**
 * DKC-009 — holdbar action-journal: intent/outcome, idempotens, reconciliation,
 * genstart, hemmlighedsredaktion og adskilt persondata-retention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { migrateDatabase } from "../src/identities.mjs";
import { createSqliteAuditLog } from "../src/adapters/audit.mjs";
import { createSqliteActionJournal } from "../src/adapters/audit-journal.mjs";
import { createCheckpointStore } from "../src/checkpoint.mjs";
import { openAuditReader, openAuditWriter } from "../src/audit-roles.mjs";
import { prepareAuditPayload, REDACTED } from "../src/redact.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-audit-journal-"));
  const anchorDir = join(dir, "anchors");
  const db = openDatabase({ path: join(dir, "audit.db") });
  migrateDatabase(db);
  const audit = createSqliteAuditLog({ db });
  const checkpoint = createCheckpointStore({ audit, anchorDir, secret: "test-secret" });
  const journal = createSqliteActionJournal({ db, audit, checkpoint });
  return { dir, db, audit, checkpoint, journal, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

test("intent skrives og committes før outcome", () => {
  const { journal, audit, cleanup } = fixture();
  try {
    const receipt = journal.begin({ tenantId: "acme", idempotencyId: "idem-1", verb: "restore", target: "db-prod", environment: "prod", actor: "spiffe://a", request: { backupRef: "s3://b" } });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.state, "pending");
    assert.ok(receipt.receipt.intentId);
    // Intent-begivenheden er allerede i den holdbare log.
    assert.equal(audit.events("acme").filter((e) => e.phase === "intent").length, 1);

    const completed = journal.complete({ tenantId: "acme", idempotencyId: "idem-1", outcome: "succeeded", result: { restored: true } });
    assert.equal(completed.ok, true);
    assert.equal(completed.state, "succeeded");
    const events = audit.events("acme");
    assert.ok(events.some((e) => e.phase === "outcome" && e.outcome === "succeeded"));
    assert.equal(audit.verifyChain("acme").ok, true);
    assert.equal(journal.verify("acme").ok, true);
  } finally {
    cleanup();
  }
});

test("et gentaget intent giver duplicate og udfører ikke igen", () => {
  const { journal, cleanup } = fixture();
  try {
    const first = journal.begin({ tenantId: "acme", idempotencyId: "idem-2", verb: "backup", target: "db", request: {} });
    assert.equal(first.ok, true);
    const second = journal.begin({ tenantId: "acme", idempotencyId: "idem-2", verb: "backup", target: "db", request: {} });
    assert.equal(second.ok, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.state, "pending");

    journal.complete({ tenantId: "acme", idempotencyId: "idem-2", outcome: "succeeded", result: { ok: true } });
    const third = journal.begin({ tenantId: "acme", idempotencyId: "idem-2", verb: "backup", target: "db", request: {} });
    assert.equal(third.duplicate, true);
    assert.equal(third.state, "succeeded");
    assert.deepEqual(third.outcome, { result: { ok: true }, error: null });
  } finally {
    cleanup();
  }
});

test("crash mellem intent og outcome giver unknown og reconciliation", () => {
  const { journal, audit, cleanup } = fixture();
  try {
    // Simulér crash: intent committet, men intet outcome.
    journal.begin({ tenantId: "acme", idempotencyId: "idem-3", verb: "restore", target: "db", request: {} });
    const resumed = journal.begin({ tenantId: "acme", idempotencyId: "idem-3", verb: "restore", target: "db", request: {} });
    assert.equal(resumed.duplicate, true);
    assert.equal(resumed.reconciliation, "unknown");

    // Reconciliation uden resolver markerer unknown — der genudføres intet.
    const unknown = journal.reconcile({ tenantId: "acme", idempotencyId: "idem-3" });
    assert.equal(unknown.resolved, false);
    assert.equal(unknown.state, "unknown");

    // Reconciliation med en resolver der spørger den eksterne ressource.
    journal.begin({ tenantId: "acme", idempotencyId: "idem-4", verb: "restore", target: "db", request: {} });
    const resolved = journal.reconcile({
      tenantId: "acme",
      idempotencyId: "idem-4",
      resolve: () => ({ outcome: "succeeded", result: { externallyVerified: true } }),
    });
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.state, "succeeded");
    assert.ok(audit.events("acme").some((e) => e.idempotencyId === "idem-4" && e.phase === "outcome" && e.outcome === "succeeded"));
  } finally {
    cleanup();
  }
});

test("hemmeligheder optræder ikke i den vedvarende log", () => {
  const { journal, audit, db, cleanup } = fixture();
  try {
    journal.begin({
      tenantId: "acme",
      idempotencyId: "idem-5",
      verb: "config.apply",
      target: "svc",
      request: { password: "hunter2", nested: { apiKey: "sk-supersecretvalue123456" }, note: "Bearer abcdefghijklmnop" },
    });
    const serialized = JSON.stringify(audit.events("acme"));
    assert.ok(!serialized.includes("hunter2"), "adgangskoden må ikke stå i loggen");
    assert.ok(!serialized.includes("sk-supersecretvalue123456"), "API-nøglen må ikke stå i loggen");
    assert.ok(!serialized.includes("abcdefghijklmnop"), "bearer-tokenet må ikke stå i loggen");
    const payload = audit.events("acme")[0].payload;
    assert.equal(payload.password, REDACTED);
    assert.equal(payload.nested.apiKey, REDACTED);
    // Også selve databasefilens bytes indeholder ingen rå hemmeligheder.
    db.raw.exec("PRAGMA wal_checkpoint(FULL)");
    const bytes = readFileSync(join(require_dir(db), "audit.db"));
    assert.ok(!bytes.includes(Buffer.from("hunter2")));
  } finally {
    cleanup();
  }
});

test("redaktøren splitter persondata fra operationelle felter", () => {
  const prepared = prepareAuditPayload({ payload: { verb: "erase", email: "a@example.org", subjectId: "s-1", token: "x" }, dataCategories: ["personal"] });
  assert.deepEqual(prepared.personal, { email: "a@example.org", subjectId: "s-1" });
  assert.deepEqual(prepared.operational, { verb: "erase", token: REDACTED });
  assert.equal(prepared.retentionClass, "personal");
  assert.equal(prepared.operational.token, REDACTED);
  assert.ok(prepared.personalDigest);
  assert.ok(prepared.payloadDigest);
});

test("persondata har egen retention og kan slettes uden at brække kæden", () => {
  const { journal, audit, cleanup } = fixture();
  try {
    const begun = journal.begin({ tenantId: "acme", idempotencyId: "idem-6", verb: "subject.export", target: "crm", request: { email: "kunde@example.org" }, dataCategories: ["personal"] });
    journal.complete({ tenantId: "acme", idempotencyId: "idem-6", outcome: "succeeded", result: { exported: 1 } });
    const digest = audit.events("acme").find((e) => e.idempotencyId === "idem-6" && e.phase === "intent").personalDataDigest;
    assert.ok(journal.readPersonal({ tenantId: "acme", digest }).payload.email);

    // Slet persondata efter retention — kæden og det operationelle spor består.
    const erased = journal.eraseExpiredPersonal({ now: Date.now() + 400 * 86_400_000 });
    assert.equal(erased.erased, 1);
    assert.equal(journal.readPersonal({ tenantId: "acme", digest }).payload, null);
    assert.equal(audit.verifyChain("acme").ok, true);
    assert.equal(journal.verify("acme").ok, true);
  } finally {
    cleanup();
  }
});

test("intents og kæde overlever genstart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-audit-restart-"));
  const anchorDir = join(dir, "anchors");
  try {
    let db = openDatabase({ path: join(dir, "audit.db") });
    migrateDatabase(db);
    let audit = createSqliteAuditLog({ db });
    let journal = createSqliteActionJournal({ db, audit, checkpoint: createCheckpointStore({ audit, anchorDir, secret: "k" }) });
    journal.begin({ tenantId: "acme", idempotencyId: "idem-r", verb: "migrate", target: "db", request: {} });
    db.close();

    db = openDatabase({ path: join(dir, "audit.db") });
    audit = createSqliteAuditLog({ db });
    journal = createSqliteActionJournal({ db, audit, checkpoint: createCheckpointStore({ audit, anchorDir, secret: "k" }) });
    assert.equal(journal.lookup({ tenantId: "acme", idempotencyId: "idem-r" }).state, "pending");
    journal.complete({ tenantId: "acme", idempotencyId: "idem-r", outcome: "succeeded", result: { version: 3 } });
    assert.equal(audit.verifyChain("acme").ok, true);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-writer og audit-reader er adskilte roller", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-audit-roles-"));
  try {
    const writer = openAuditWriter({ dataDir: dir, anchorDir: join(dir, "anchors"), secret: "k" });
    assert.equal(writer.role, "audit-writer");
    writer.journal.begin({ tenantId: "acme", idempotencyId: "r-1", verb: "backup", target: "db", request: {} });
    writer.close();

    const reader = openAuditReader({ dataDir: dir, anchorDir: join(dir, "anchors"), secret: "k" });
    assert.equal(reader.role, "audit-reader");
    assert.equal(reader.readOnly, true);
    assert.equal(reader.verifyChain("acme").ok, true);
    assert.equal(reader.verifyCheckpoint({ tenantId: "acme" }).ok, true);
    assert.equal(typeof reader.append, "undefined", "læseren må ikke eksponere skrivning");
    assert.equal(typeof reader.journal, "undefined", "læseren må ikke eksponere journalen");
    reader.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Hjælper: find mappen som databasen ligger i via db.path.
function require_dir(db) {
  return dirname(db.path);
}
