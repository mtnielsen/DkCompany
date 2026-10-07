import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryKeyProvider } from "../src/keys.mjs";
import { createSuppressionLedger } from "../src/suppression.mjs";
import { createBackup } from "../src/vault.mjs";
import { functionalChecks, restoreBackup } from "../src/restore.mjs";
import { openDatabase } from "../../persistence/src/index.mjs";
import { createFixture } from "./support/fixtures.mjs";

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-restore-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function makeBackup(fixture, dir, ledger) {
  const keyProvider = createMemoryKeyProvider();
  const created = await createBackup({ db: fixture.db, tenantId: "acme", outDir: join(dir, "backup"), keyProvider, suppressionLedger: ledger, source: { moduleRef: "audit-service", serviceClassRef: "continuity/service-classes/audit-service.service-class.json" } });
  return { keyProvider, ...created };
}

test("isolaret gendannelse verificerer integritet, tenant-afgrænsning og audit-kæde", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const { keyProvider, manifest, storeDir } = await makeBackup(fixture, dir, ledger);
    const restored = restoreBackup({ storeDir, manifest, keyProvider, targetDir: join(dir, "restored"), suppressionLedger: ledger });
    assert.equal(restored.integrity, "ok");
    assert.equal(restored.suppression.applied, true);

    const checks = functionalChecks({ dbPath: restored.dbPath, checkpoint: { anchorDir: fixture.anchorDir, secret: "anchor-secret", tenantId: "acme" } });
    for (const check of checks) assert.equal(check.status, "pass", `${check.name}: ${check.detail}`);
    assert.ok(checks.some((c) => c.name === "tenant-isolation"));
    assert.ok(checks.some((c) => c.name === "audit-checkpoint"));
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("persondata slettet efter backupen genindføres ikke", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    const { keyProvider, manifest, storeDir } = await makeBackup(fixture, dir, ledger);
    assert.ok(fixture.personalDigest);
    // Sletningen sker efter backupens skæringstidspunkt.
    ledger.append({ tenantId: "acme", digest: fixture.personalDigest, subjectKey: "acme@example.org", erasedAt: new Date(Date.parse(manifest.createdAt) + 60_000).toISOString(), reason: "dsar-erasure" });

    const restored = restoreBackup({ storeDir, manifest, keyProvider, targetDir: join(dir, "restored"), suppressionLedger: ledger });
    assert.equal(restored.suppression.recordsErased, 1);
    const db = openDatabase({ path: restored.dbPath, readOnly: true });
    const row = db.get("SELECT payload, erased_at FROM audit_personal WHERE tenant_id = 'acme' AND digest = ?", fixture.personalDigest);
    db.close();
    assert.equal(row.payload, "{}");
    assert.ok(row.erased_at);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("en sletning før backupen genindfører ikke data (posten findes ikke i backupen)", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    ledger.append({ tenantId: "acme", digest: fixture.personalDigest, erasedAt: new Date(Date.parse("2020-01-01T00:00:00Z")).toISOString() });
    const { keyProvider, manifest, storeDir } = await makeBackup(fixture, dir, ledger);
    const restored = restoreBackup({ storeDir, manifest, keyProvider, targetDir: join(dir, "restored"), suppressionLedger: ledger });
    // Posten var allerede slettet før backupen, så der er intet at slette nu.
    assert.equal(restored.suppression.entries, 0);
    assert.equal(restored.suppression.recordsErased, 0);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("en trunkeret suppressionsjournal afvises", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    ledger.append({ tenantId: "acme", digest: "a".repeat(64) });
    const { keyProvider, manifest, storeDir } = await makeBackup(fixture, dir, ledger);
    // Fjern den pinned post (trunkering) og erstat med en ny, der ikke er efterkommer.
    rmSync(ledger.path, { force: true });
    const truncated = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
    truncated.append({ tenantId: "acme", digest: "b".repeat(64) });
    assert.throws(() => restoreBackup({ storeDir, manifest, keyProvider, targetDir: join(dir, "restored"), suppressionLedger: truncated }), /trunkeret/);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});
