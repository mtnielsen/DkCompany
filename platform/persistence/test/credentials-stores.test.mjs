/**
 * DKC-010 — holdbare credential-stores: tilbagekaldelse, nødstop og udstedelser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { migrateDatabase } from "../src/identities.mjs";
import { createSqliteRevocationStore } from "../src/adapters/revocations.mjs";
import { createSqliteStopStore } from "../src/adapters/stops.mjs";
import { createSqliteIssuanceLedger } from "../src/adapters/issuances.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-credential-stores-"));
  const db = openDatabase({ path: join(dir, "credentials.db") });
  migrateDatabase(db);
  return { dir, db, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

test("revocation-listen er holdbar og kan fjerne udløbne poster", () => {
  const { dir, db, cleanup } = fixture();
  try {
    const store = createSqliteRevocationStore({ db });
    store.put({ key: "jti:a", scope: "credential", jti: "a", spiffeId: null, tenantId: "acme", reason: "x", revokedBy: "oidc|sec", revokedAt: "2025-01-01T00:00:00Z", expiresAt: null });
    store.put({ key: "agent:s", scope: "agent", jti: null, spiffeId: "s", tenantId: "acme", reason: "y", revokedBy: "oidc|sec", revokedAt: "2025-01-01T00:00:00Z", expiresAt: null });
    assert.equal(store.all().length, 2);
    assert.equal(store.get("jti:a").jti, "a");
    db.close();

    const reopened = openDatabase({ path: join(dir, "credentials.db") });
    migrateDatabase(reopened);
    const store2 = createSqliteRevocationStore({ db: reopened });
    assert.equal(store2.all().length, 2);
    assert.equal(store2.get("agent:s").spiffeId, "s");
    assert.equal(store2.remove("jti:a"), true);
    assert.equal(store2.all().length, 1);
    reopened.close();
  } finally {
    cleanup();
  }
});

test("nødstop-tilstanden er holdbar og kan ophæves", () => {
  const { dir, db, cleanup } = fixture();
  try {
    const store = createSqliteStopStore({ db });
    store.put({ scope: "global", subjectId: null, active: true, reason: "incident", activatedBy: "oidc|sec", activatedAt: "2025-01-01T00:00:00Z" });
    store.put({ scope: "tenant", subjectId: "acme", active: true, reason: "kunde", activatedBy: "oidc|adm", activatedAt: "2025-01-01T00:00:00Z" });
    assert.equal(store.get("global", null).active, true);
    assert.equal(store.get("tenant", "acme").active, true);
    assert.equal(store.get("agent", "spiffe://none"), null);
    db.close();

    const reopened = openDatabase({ path: join(dir, "credentials.db") });
    migrateDatabase(reopened);
    const store2 = createSqliteStopStore({ db: reopened });
    assert.equal(store2.get("global", null).active, true);
    store2.put({ ...store2.get("global", null), active: false, clearedBy: "oidc|sec", clearedAt: "2025-01-02T00:00:00Z" });
    assert.equal(store2.get("global", null).active, false);
    reopened.close();
  } finally {
    cleanup();
  }
});

test("udstedelsesjournalen registrerer jti og scope", () => {
  const { db, cleanup } = fixture();
  try {
    const ledger = createSqliteIssuanceLedger({ db });
    ledger.record({ jti: "j-1", tenantId: "acme", spiffeId: "spiffe://a", agentRef: "a", role: "executor", verb: "upgrade.patch", resource: "dummy-ok", audience: "module:dummy-ok", environment: "staging", issuedAt: "2025-01-01T00:00:00Z", expiresAt: "2025-01-01T00:05:00Z" });
    assert.equal(ledger.list().length, 1);
    assert.equal(ledger.byJti("j-1").verb, "upgrade.patch");
  } finally {
    cleanup();
  }
});
