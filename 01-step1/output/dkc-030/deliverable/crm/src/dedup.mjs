/**
 * DKC-030 — dublethåndtering og idempotent retry.
 *
 * To mekanismer holdes adskilt:
 *
 *   1. **Idempotent retry.** En import bærer en idempotency-nøgle. Gentages
 *      den, returneres den samme post — der oprettes ingen dublet. Nøglen
 *      håndhæves tenant-bundet via DKC-043's `createEventDeduper`.
 *   2. **Dublethåndtering på forretningsidentitet.** Hver entitetstype har en
 *      dedup-nøgle (fx e-mail for en kontakt, CVR for en virksomhed). Findes en
 *      post med samme nøgle i samme tenant, opdateres den i stedet for at
 *      oprette en ny. Er den fundne post en *anden* upstream-post, flettes de
 *      aldrig automatisk: det er en konflikt der kræver et menneske (DKC-043's
 *      `assertStorageDedupAllowed`).
 */
import { digestOf } from "../../runtime/src/digest.mjs";
import { assertStorageDedupAllowed } from "../../dedup/src/objects.mjs";
import { createEventDeduper } from "../../dedup/src/events.mjs";

export class CrmDedupError extends Error {
  constructor(message, code = "crm_dedup_error") {
    super(message);
    this.name = "CrmDedupError";
    this.code = code;
  }
}

/** Beregn en tenantafgrænset dedup-nøgle ud fra de erklærede identitetsfelter. */
export function dedupKeyFor({ tenantId, entityType, record, dedupKeys } = {}) {
  const fields = dedupKeys?.[entityType];
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new CrmDedupError(`entitetstypen '${entityType}' har ingen dedup-nøgler`, "missing_dedup_keys");
  }
  const values = {};
  for (const field of fields) {
    const value = record?.[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new CrmDedupError(`posten mangler identitetsfeltet '${field}'`, "missing_identity_field");
    }
    values[field] = String(value).trim().toLowerCase();
  }
  return digestOf({ tenantId, entityType, values });
}

/** Planlæg en import: opret, opdater eller en konflikt der kræver et menneske. */
export function planImport({ store, reference, tenantId, entityType, record, dedupKeys } = {}) {
  if (!store || !reference) throw new CrmDedupError("planImport kræver en butik og en reference");
  const dedupKey = dedupKeyFor({ tenantId, entityType, record, dedupKeys });
  const existingByReference = store.getRecord(reference);
  if (existingByReference) return { action: "update", dedupKey, existing: existingByReference };
  const existingByDedup = store.findByDedupKey(tenantId, entityType, dedupKey);
  if (existingByDedup && existingByDedup.reference !== reference) {
    // DKC-043: forretningsposter må aldrig flettes automatisk. Konflikten
    // returneres til et menneske i stedet for at blive slået sammen.
    return { action: "conflict", dedupKey, existing: existingByDedup };
  }
  return { action: "create", dedupKey, existing: null };
}

/**
 * Ethvert forsøg på at lade storage-dedup flette forretningsposter afvises af
 * DKC-043. Funktionen findes, så invarianten er eksplicit og kan efterprøves.
 */
export function mergeBusinessRecords() {
  assertStorageDedupAllowed("business-records");
  throw new CrmDedupError("uventet: storage-dedup tillod en fletning af forretningsposter", "unexpected_merge_allowed");
}

/**
 * Deduper for idempotency-nøgler. Bruger DKC-043's begivenheds-deduper, men
 * med et langt vindue. Returnerer `{ duplicate, key }`.
 */
export function createImportDeduper({ windowSeconds = 30 * 24 * 3600 } = {}) {
  const deduper = createEventDeduper({ windowSeconds });
  return {
    kind: "crm-import-deduper",
    windowSeconds,
    decide({ tenantId, entityType, upstreamId, version, idempotencyKey } = {}) {
      if (!idempotencyKey) throw new CrmDedupError("importen kræver en idempotency-nøgle", "missing_idempotency_key");
      return deduper.decide({
        id: idempotencyKey,
        tenantid: tenantId,
        data: { resource: { type: entityType, id: String(upstreamId ?? idempotencyKey), version: version ?? 1 } },
      });
    },
    size() {
      return deduper.size();
    },
  };
}
