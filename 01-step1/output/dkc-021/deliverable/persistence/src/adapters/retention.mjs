/**
 * DKC-021 — holdbart slette- og holdregister.
 *
 * Adapteren giver legal holds, slette-kvitteringer og restore-gates et
 * vedvarende, tenant-bundet hjem. Hver metode normaliserer tenant-id'et og
 * filtrerer eksplicit på `tenant_id`, så en fremmed tenant ikke kan læse eller
 * frigive en andens hold eller kvittering. Tjenestelaget ovenover håndhæver
 * autorisationen (default-deny, AI-nægtelse og to-personers hold).
 */
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";
import { legalHoldProblems, holdCovers } from "../../../retention/src/holds.mjs";

export class RetentionStoreError extends Error {
  constructor(message, code = "retention_store_error") {
    super(message);
    this.name = "RetentionStoreError";
    this.code = code;
  }
}

function parse(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

function holdRecord(row) {
  if (!row) return null;
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "LegalHold",
    holdId: row.hold_id,
    tenantId: row.tenant_id,
    subjectDigest: row.subject_digest,
    dataClasses: parse(row.data_classes) ?? [],
    moduleRef: row.module_ref,
    reason: row.reason,
    placedBy: parse(row.placed_by),
    approvedBy: parse(row.approved_by),
    placedAt: row.placed_at,
    reviewAt: row.review_at,
    status: row.status,
    releasedBy: parse(row.released_by),
    releaseReason: row.release_reason,
    releasedAt: row.released_at,
  };
}

export function createSqliteRetentionStore({ db, clock = () => Date.now(), kind = "sqlite-retention-store" } = {}) {
  if (!db) throw new RetentionStoreError("createSqliteRetentionStore kræver en database");

  const insertHold = db.prepare(`INSERT INTO retention_holds(
      hold_id, tenant_id, subject_digest, data_classes, module_ref, reason, placed_by, approved_by,
      placed_at, review_at, status, released_by, release_reason, released_at, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, NULL, ?)`);
  const getHoldStmt = db.prepare("SELECT * FROM retention_holds WHERE tenant_id = ? AND hold_id = ?");
  const listHoldsStmt = db.prepare("SELECT * FROM retention_holds WHERE tenant_id = ? ORDER BY placed_at, hold_id");
  const listActiveBySubject = db.prepare("SELECT * FROM retention_holds WHERE tenant_id = ? AND subject_digest = ? AND status = 'active' ORDER BY placed_at");
  const listActive = db.prepare("SELECT * FROM retention_holds WHERE tenant_id = ? AND status = 'active' ORDER BY placed_at");
  const releaseHoldStmt = db.prepare("UPDATE retention_holds SET status = 'released', released_by = ?, release_reason = ?, released_at = ?, document = ? WHERE tenant_id = ? AND hold_id = ? AND status = 'active'");

  const insertReceipt = db.prepare(`INSERT INTO retention_deletion_receipts(
      receipt_id, tenant_id, subject_digest, status, requested_by, requested_at, completed_at,
      records_affected, remaining_copies, intent_id, outcome_id, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(receipt_id) DO UPDATE SET
      status = excluded.status, completed_at = excluded.completed_at, records_affected = excluded.records_affected,
      remaining_copies = excluded.remaining_copies, intent_id = excluded.intent_id, outcome_id = excluded.outcome_id,
      document = excluded.document`);
  const getReceiptStmt = db.prepare("SELECT * FROM retention_deletion_receipts WHERE tenant_id = ? AND receipt_id = ?");
  const listReceiptsStmt = db.prepare("SELECT * FROM retention_deletion_receipts WHERE tenant_id = ? ORDER BY requested_at, receipt_id");

  const insertGate = db.prepare(`INSERT INTO retention_restore_gates(
      gate_id, tenant_id, restore_point, status, pinned_ledger_head, applied_ledger_head, applied_entries,
      records_erased, opened_at, applied_at, released_at, released_by, document)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(gate_id) DO UPDATE SET
      status = excluded.status, pinned_ledger_head = excluded.pinned_ledger_head, applied_ledger_head = excluded.applied_ledger_head,
      applied_entries = excluded.applied_entries, records_erased = excluded.records_erased, applied_at = excluded.applied_at,
      released_at = excluded.released_at, released_by = excluded.released_by, document = excluded.document`);
  const getGateStmt = db.prepare("SELECT * FROM retention_restore_gates WHERE tenant_id = ? AND gate_id = ?");

  function receiptRecord(row) {
    return row ? parse(row.document) : null;
  }

  function gateRecord(row) {
    return row ? parse(row.document) : null;
  }

  return {
    kind,

    placeHold(tenantId, hold) {
      const tenant = normalizeTenantId(tenantId);
      const problems = legalHoldProblems(hold);
      if (problems.length) throw new RetentionStoreError(problems.map((p) => `${p.path} ${p.message}`).join("; "), "hold_invalid");
      insertHold.run(
        hold.holdId,
        tenant,
        hold.subjectDigest,
        JSON.stringify(hold.dataClasses ?? []),
        hold.moduleRef ?? null,
        hold.reason,
        JSON.stringify(hold.placedBy),
        JSON.stringify(hold.approvedBy),
        hold.placedAt,
        hold.reviewAt ?? null,
        JSON.stringify(hold)
      );
      return holdRecord(getHoldStmt.get(tenant, hold.holdId));
    },
    getHold: (tenantId, holdId) => holdRecord(getHoldStmt.get(normalizeTenantId(tenantId), holdId)),
    listHolds(tenantId, { includeReleased = false, subjectDigest = null } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const rows = subjectDigest
        ? listActiveBySubject.all(tenant, subjectDigest)
        : includeReleased
          ? listHoldsStmt.all(tenant)
          : listActive.all(tenant);
      return rows.map(holdRecord);
    },
    activeHoldsFor(tenantId, { subjectDigest, dataClasses = [] } = {}) {
      const tenant = normalizeTenantId(tenantId);
      return listActiveBySubject.all(tenant, subjectDigest).map(holdRecord).filter((h) => holdCovers(h, { subjectDigest, dataClasses }));
    },
    releaseHold(tenantId, holdId, { releasedBy, releaseReason, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const current = holdRecord(getHoldStmt.get(tenant, holdId));
      if (!current) throw new RetentionStoreError(`ukendt hold '${holdId}'`, "hold_not_found");
      if (current.status === "released") return current;
      const released = { ...current, status: "released", releasedBy, releaseReason, releasedAt: new Date(now).toISOString() };
      const problems = legalHoldProblems(released);
      if (problems.length) throw new RetentionStoreError(problems.map((p) => `${p.path} ${p.message}`).join("; "), "hold_release_invalid");
      releaseHoldStmt.run(JSON.stringify(releasedBy), releaseReason, released.releasedAt, JSON.stringify(released), tenant, holdId);
      return holdRecord(getHoldStmt.get(tenant, holdId));
    },

    saveReceipt(tenantId, receipt) {
      const tenant = normalizeTenantId(tenantId);
      insertReceipt.run(
        receipt.receiptId,
        tenant,
        receipt.subjectDigest,
        receipt.status,
        receipt.requestedBy,
        receipt.requestedAt,
        receipt.completedAt,
        receipt.summary?.recordsAffected ?? 0,
        receipt.summary?.remainingCopies ?? 0,
        receipt.audit?.intentId ?? null,
        receipt.audit?.outcomeId ?? null,
        JSON.stringify(receipt)
      );
      return receiptRecord(getReceiptStmt.get(tenant, receipt.receiptId));
    },
    getReceipt: (tenantId, receiptId) => receiptRecord(getReceiptStmt.get(normalizeTenantId(tenantId), receiptId)),
    listReceipts: (tenantId) => listReceiptsStmt.all(normalizeTenantId(tenantId)).map(receiptRecord),

    saveRestoreGate(tenantId, gate) {
      const tenant = normalizeTenantId(tenantId);
      insertGate.run(
        gate.gateId,
        tenant,
        gate.restorePointIso,
        gate.status,
        gate.pinnedLedgerHead ?? null,
        gate.appliedLedgerHead ?? null,
        gate.appliedEntries ?? 0,
        gate.recordsErased ?? 0,
        gate.openedAt,
        gate.appliedAt ?? null,
        gate.releasedAt ?? null,
        gate.releasedBy ?? null,
        JSON.stringify(gate)
      );
      return gateRecord(getGateStmt.get(tenant, gate.gateId));
    },
    getRestoreGate: (tenantId, gateId) => gateRecord(getGateStmt.get(normalizeTenantId(tenantId), gateId)),
  };
}
