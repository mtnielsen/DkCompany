/**
 * DKC-016 — fælles testfixture: en migreret SQLite-database med to tenants,
 * audit-hændelser, persondata (audit_personal) og et eksternt checkpoint.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheckpointStore, createMigrator, createSqliteAuditLog, openDatabase } from "../../../persistence/src/index.mjs";
import { createSqliteActionJournal } from "../../../persistence/src/adapters/audit-journal.mjs";

export function createFixture({ tenantId = "acme", otherTenant = "globex" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-backup-"));
  const dbPath = join(dir, "live.db");
  const db = openDatabase({ path: dbPath });
  createMigrator({ db }).apply();
  const audit = createSqliteAuditLog({ db });
  const journal = createSqliteActionJournal({ db, audit });

  audit.append({ tenantId, type: "fixture.start", payload: { hello: "world" } });
  journal.begin({
    tenantId,
    idempotencyId: `idem-${tenantId}`,
    verb: "backup",
    target: "fixture",
    request: { email: `${tenantId}@example.org`, note: "syntetisk" },
    dataCategories: ["personal"],
  });
  audit.append({ tenantId: otherTenant, type: "fixture.other", payload: { tenant: otherTenant } });

  const personalRow = db.get("SELECT digest FROM audit_personal WHERE tenant_id = ? ORDER BY created_at DESC, digest DESC LIMIT 1", tenantId);
  const anchorDir = join(dir, "anchors");
  const checkpoints = createCheckpointStore({ audit, anchorDir, secret: "anchor-secret" });
  checkpoints.anchor({ tenantId });

  return {
    dir,
    dbPath,
    db,
    audit,
    journal,
    checkpoints,
    anchorDir,
    tenantId,
    otherTenant,
    personalDigest: personalRow?.digest ?? null,
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
