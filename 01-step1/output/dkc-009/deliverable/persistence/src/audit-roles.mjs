/**
 * DKC-009 — adskilte audit-skrive- og læseroller.
 *
 * Audit-loggen har brug for to mindst-privilegerede identiteter:
 *
 *   - **audit-writer** må kun skrive (intent/outcome/append) og forankre et
 *     checkpoint. Den kan ikke eksportere persondata eller læse hele loggen.
 *   - **audit-reader** åbner databasen skrivebeskyttet (håndhævet af SQLite) og
 *     må læse og verificere — men har ingen skrive-metode.
 *
 * Rollerne er den logiske adskillelse; i produktion er den tilsvarende
 * PostgreSQL-opsætning separate roller med GRANTs, hvor `audit_reader` kun har
 * SELECT og `audit_writer` kun INSERT. Se `docs/spec/audit-durability.md`.
 */
import { openIdentity } from "./identities.mjs";
import { createSqliteActionJournal } from "./adapters/audit-journal.mjs";
import { createCheckpointStore } from "./checkpoint.mjs";

function makeCheckpoint({ audit, anchorDir, secret, clock }) {
  if (!anchorDir || !secret) return null;
  return createCheckpointStore({ audit, anchorDir, secret, clock });
}

/** Åbn audit-skriverrollen (læs/skriv, men uden læse-eksport i API'et). */
export function openAuditWriter({ dataDir, anchorDir = null, secret = null, clock = () => Date.now(), migrate = true } = {}) {
  if (!dataDir) throw new Error("openAuditWriter kræver en dataDir");
  const identity = openIdentity("audit", { dataDir, clock, migrate });
  const audit = identity.repository("audit");
  const checkpoint = makeCheckpoint({ audit, anchorDir, secret, clock });
  const journal = createSqliteActionJournal({ db: identity.db, audit, checkpoint, clock });
  return {
    role: "audit-writer",
    capabilities: ["append", "intent", "outcome", "anchor"],
    journal,
    /** Den underliggende hash-kædede log (til audit-servicens egen oplæsning). */
    log: audit,
    /** Append-only skrivning til den hash-kædede log. */
    append(event) {
      return audit.append(event);
    },
    anchor(options = {}) {
      if (!checkpoint) throw new Error("audit-writer er ikke konfigureret med en anchorDir+secret");
      return checkpoint.anchor(options);
    },
    verifyLocal(tenantId = null) {
      return audit.verifyChain(tenantId);
    },
    close() {
      identity.close();
    },
  };
}

/** Åbn audit-læserrollen (skrivebeskyttet; ingen skrive-metode). */
export function openAuditReader({ dataDir, anchorDir = null, secret = null, clock = () => Date.now() } = {}) {
  if (!dataDir) throw new Error("openAuditReader kræver en dataDir");
  const identity = openIdentity("audit", { dataDir, readOnly: true, migrate: false, clock });
  const audit = identity.repository("audit");
  const checkpoint = makeCheckpoint({ audit, anchorDir, secret, clock });
  return {
    role: "audit-reader",
    capabilities: ["read", "verify"],
    readOnly: true,
    events(tenantId = null) {
      return audit.events(tenantId);
    },
    verifyChain(tenantId = null) {
      return audit.verifyChain(tenantId);
    },
    verifyCheckpoint({ tenantId = null, anchor = null } = {}) {
      if (!checkpoint) return { ok: false, problems: [{ type: "no-checkpoint-store", detail: "læseren er ikke konfigureret med anchorDir+secret" }], anchoredCount: null, currentCount: audit.events(tenantId).length };
      return checkpoint.verify({ tenantId, anchor });
    },
    listCheckpoints(tenantId = null) {
      return checkpoint ? checkpoint.listAnchors(tenantId) : [];
    },
    readPersonal({ tenantId, digest } = {}) {
      const row = identity.db.get("SELECT * FROM audit_personal WHERE tenant_id = ? AND digest = ?", tenantId, digest);
      if (!row) return null;
      return { tenantId: row.tenant_id, digest: row.digest, subjectKey: row.subject_key, categories: JSON.parse(row.categories), payload: row.payload === "{}" ? null : JSON.parse(row.payload), retainUntil: row.retain_until, erasedAt: row.erased_at };
    },
    close() {
      identity.close();
    },
  };
}

export function auditRoles() {
  return ["audit-writer", "audit-reader"];
}
