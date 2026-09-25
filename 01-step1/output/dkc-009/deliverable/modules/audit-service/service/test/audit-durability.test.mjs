/**
 * DKC-009 — audit-servicen bruger den holdbare action-journal.
 *
 * Beviser at tjenesten skriver en holdbar intent før handleren, at en
 * utilgængelig journal giver nul eksterne ændringer (fail-closed), og at
 * HTTP-journalendpointene virker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditService } from "../src/server.mjs";
import { AuthError } from "../src/auth.mjs";
import { openDatabase } from "../../../../persistence/src/db.mjs";
import { migrateDatabase } from "../../../../persistence/src/identities.mjs";
import { createSqliteAuditLog } from "../../../../persistence/src/adapters/audit.mjs";
import { createSqliteActionJournal } from "../../../../persistence/src/adapters/audit-journal.mjs";
import { createCheckpointStore } from "../../../../persistence/src/checkpoint.mjs";

const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/x", spiffeId: "spiffe://platform.example.org/agents/x", tenantId: "acme", autonomyClass: "A2" };
const authenticate = (auth) => {
  if (!auth) throw new AuthError("manglende token");
  return agent;
};
const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-audit-service-"));
  const db = openDatabase({ path: join(dir, "audit.db") });
  migrateDatabase(db);
  const audit = createSqliteAuditLog({ db });
  const checkpoint = createCheckpointStore({ audit, anchorDir: join(dir, "anchors"), secret: "k" });
  const journal = createSqliteActionJournal({ db, audit, checkpoint });
  return { dir, db, audit, journal, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

async function start(service) {
  const port = await service.listen(0);
  const call = (path, { method = "POST", body, headers = {} } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", authorization: "Bearer test", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { call, close: () => service.close() };
}

test("en tillad handling skriver holdbar intent og outcome", async () => {
  const { journal, audit, cleanup } = fixture();
  try {
    const service = createAuditService({ authenticate, pdp: allowPdp, journal });
    const { call, close } = await start(service);
    try {
      const res = await call("/v1/ops/backup", { body: { evidence: ["policy-allow"] }, headers: { "idempotency-key": "svc-1" } });
      assert.equal(res.status, 200);
      const phases = audit.events("acme").map((e) => e.phase).filter(Boolean);
      assert.deepEqual(phases, ["intent", "outcome"]);
      assert.equal(journal.lookup({ tenantId: "acme", idempotencyId: "svc-1" }).state, "succeeded");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("en gentaget handling afspilles idempotent", async () => {
  const { journal, cleanup } = fixture();
  try {
    const service = createAuditService({ authenticate, pdp: allowPdp, journal });
    const { call, close } = await start(service);
    try {
      await call("/v1/ops/backup", { body: { evidence: ["policy-allow"] }, headers: { "idempotency-key": "svc-2" } });
      const second = await call("/v1/ops/backup", { body: { evidence: ["policy-allow"] }, headers: { "idempotency-key": "svc-2" } });
      assert.equal(second.status, 200);
      assert.equal((await second.json()).idempotentReplay, true);
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test("utilgængelig journal giver 503 og ingen completed-begivenhed", async () => {
  const failing = {
    begin: async () => {
      throw new Error("audit-database utilgængelig");
    },
    complete: async () => ({ ok: true }),
  };
  const service = createAuditService({ authenticate, pdp: allowPdp, journal: failing });
  const { call, close } = await start(service);
  try {
    const res = await call("/v1/ops/backup", { body: { evidence: ["policy-allow"] } });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.failMode, "closed");
    assert.equal(body.status, "halted");
    assert.ok(!service.log.events.some((e) => e.type === "backup.completed"), "handlingen må ikke logges som gennemført");
    assert.ok(service.log.events.some((e) => e.type === "audit.unavailable"));
  } finally {
    await close();
  }
});

test("HTTP-journalendpointene skriver, læser og afslutter et intent", async () => {
  const { journal, cleanup } = fixture();
  try {
    const service = createAuditService({ authenticate, pdp: allowPdp, journal });
    const { call, close } = await start(service);
    try {
      const begun = await call("/v1/audit/intents", { body: { idempotencyId: "http-1", verb: "backup", target: "db" } });
      assert.equal(begun.status, 201);
      const got = await call("/v1/audit/intents/http-1", { method: "GET" });
      assert.equal(got.status, 200);
      assert.equal((await got.json()).state, "pending");
      const done = await call("/v1/audit/intents/http-1/outcome", { body: { outcome: "succeeded", result: { ok: true } } });
      assert.equal(done.status, 200);
      assert.equal(journal.lookup({ tenantId: "acme", idempotencyId: "http-1" }).state, "succeeded");
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
