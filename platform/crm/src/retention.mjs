/**
 * DKC-030 — tværgående sletning der følger ejerskab, retention og kopier.
 *
 * En sletning kræver ejerskab eller skriveadgang i samme tenant; en
 * tværtenant-reference afvises. Et legal hold blokerer sletningen (DKC-021's
 * `holdCovers`). Sletningen er fladvis og ærlig:
 *
 *   - **primary**    — posten tombstoned,
 *   - **activities** — postens aktiviteter fjernes,
 *   - **index**      — indeksposten fjernes,
 *   - **copies**     — platformens kopier fjernes,
 *   - **backup**     — en WORM-låst backupkopi kan ikke fjernes før dens
 *                      retention er udløbet og opgives som resterende kopi.
 */
import { subjectDigestOf, holdCovers } from "../../retention/src/holds.mjs";
import { assertReferenceTenant, parseReference } from "./references.mjs";
import { decideRecordWrite } from "./permissions.mjs";

export class CrmRetentionError extends Error {
  constructor(message, code = "crm_retention_error", status = 400) {
    super(message);
    this.name = "CrmRetentionError";
    this.code = code;
    this.status = status;
  }
}

const DAY_MS = 86_400_000;

function emptySurfaces() {
  return {
    primary: { status: "full", recordsAffected: 0 },
    activities: { status: "full", recordsAffected: 0 },
    index: { status: "full", recordsAffected: 0 },
    copies: { status: "full", recordsAffected: 0 },
    backup: { status: "full", recordsAffected: 0 },
  };
}

function blockingHold(holds, subjectDigest, dataClasses) {
  return holds.find((h) => holdCovers(h, { subjectDigest, dataClasses })) ?? null;
}

/**
 * Slet én post på tværs af alle flader.
 *
 * @returns en CrmDeletionReceipt.
 */
export function deleteRecord({ store, reference, principal, source = null, holds = [], reason, now = new Date().toISOString() } = {}) {
  if (!principal?.tenantId) throw new CrmRetentionError("sletning kræver en verificeret principal med tenant", "missing_principal", 401);
  const parsed = assertReferenceTenant(reference, principal.tenantId);
  const record = store.getRecord(reference);
  if (!record) throw new CrmRetentionError(`posten '${reference}' findes ikke`, "not_found", 404);

  const decision = source ? decideRecordWrite({ principal, record, source }) : { allowed: principal.subject === record.owner?.subject };
  if (!decision.allowed) throw new CrmRetentionError(`sletning nægtet (${decision.reason ?? "not-owner"})`, "access_denied", 403);

  const subjectDigest = subjectDigestOf(record.owner?.subject ?? reference);
  const blocking = blockingHold(holds, subjectDigest, [record.classification ?? "personal"]);
  if (blocking) {
    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "CrmDeletionReceipt",
      tenantId: record.tenantId,
      accountReference: reference,
      entityType: parsed.entityType,
      reason,
      status: "blocked",
      legalHoldId: blocking.holdId ?? blocking.id ?? null,
      surfaces: Object.fromEntries(Object.entries(emptySurfaces()).map(([k, v]) => [k, { ...v, status: "blocked", recordsAffected: 0 }])),
      remainingCopies: [],
      createdAt: now,
    };
  }

  const surfaces = emptySurfaces();
  const remainingCopies = [];

  store.tombstoneRecord(reference, { at: now });
  surfaces.primary.recordsAffected += 1;

  surfaces.activities.recordsAffected += store.removeActivities(reference);

  if (store.removeIndexEntry(reference)) surfaces.index.recordsAffected += 1;

  for (const copy of store.listCopies(reference)) {
    if (copy.surface === "backup") {
      // WORM-låst backup: fjernes kun når retentionen er udløbet.
      const expiresAt = copy.expiresAt ?? new Date(Date.parse(record.updatedAt ?? now) + (source?.retention?.copyDays ?? 90) * DAY_MS).toISOString();
      if (Date.parse(now) >= Date.parse(expiresAt)) {
        store.removeCopyBlob(copy.ref);
        store.removeCopy(reference, copy.surface);
        surfaces.copies.recordsAffected += 1;
      } else {
        remainingCopies.push({ kind: "backup", resource: copy.ref, reason: "WORM-låst backup indtil retentionen udløber", expiresAt });
        surfaces.backup.status = "partial";
      }
      continue;
    }
    if (store.removeCopyBlob(copy.ref)) surfaces.copies.recordsAffected += 1;
    store.removeCopy(reference, copy.surface);
  }

  const status = remainingCopies.length ? "partial" : "full";
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "CrmDeletionReceipt",
    tenantId: record.tenantId,
    accountReference: reference,
    entityType: parsed.entityType,
    reason,
    status,
    legalHoldId: null,
    surfaces,
    remainingCopies,
    createdAt: now,
  };
}

function relatedReferences(store, tenantId, accountReference) {
  const account = store.getRecord(accountReference);
  const accountUpstream = account?.upstreamId;
  return store
    .listRecords({ tenantId, includeDeleted: false })
    .filter((r) => r.entityType !== "Account" && (r.data?.accountId === accountUpstream || r.data?.accountId === accountReference))
    .map((r) => r.reference);
}

/**
 * Slet en kunde (en virksomhed og alle dens kontakter, salgsforløb og
 * aktiviteter) på tværs af alle flader.
 */
export function deleteCustomer({ store, tenantId, accountReference, principal, source = null, holds = [], reason, now = new Date().toISOString() } = {}) {
  if (principal?.tenantId !== tenantId) throw new CrmRetentionError("kunden tilhører en anden tenant", "cross_tenant", 403);
  const related = relatedReferences(store, tenantId, accountReference);
  const receipts = [];
  for (const reference of [...related, accountReference]) {
    receipts.push(deleteRecord({ store, reference, principal, source, holds, reason, now }));
  }
  const surfaces = emptySurfaces();
  const remainingCopies = [];
  let blocked = null;
  for (const receipt of receipts) {
    if (receipt.status === "blocked") blocked = receipt;
    for (const [surface, value] of Object.entries(receipt.surfaces)) {
      surfaces[surface].recordsAffected += value.recordsAffected;
      if (value.status !== "full") surfaces[surface].status = value.status;
    }
    remainingCopies.push(...receipt.remainingCopies);
  }
  if (blocked) {
    return { ...blocked, accountReference, status: "blocked", relatedRecords: related.length };
  }
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "CrmDeletionReceipt",
    tenantId,
    accountReference,
    entityType: "Account",
    reason,
    status: remainingCopies.length ? "partial" : "full",
    legalHoldId: null,
    relatedRecords: related.length,
    surfaces,
    remainingCopies,
    createdAt: now,
  };
}
