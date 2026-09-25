/**
 * DKC-031 — dublethåndtering uden automatisk fletning.
 *
 * Dedup-nøglen beregnes tenantafgrænset ud fra kildens erklærede
 * identitetsfelter for entitetstypen. To forskellige kildeobjekter med samme
 * forretningsidentitet flettes **aldrig** automatisk — det er en konflikt der
 * kræver et menneske. Reglen håndhæves af DKC-043's
 * `assertStorageDedupAllowed`, så storage-dedup heller ikke kan flette dem.
 */
import { digestOf } from "../../runtime/src/digest.mjs";
import { assertStorageDedupAllowed } from "../../dedup/src/objects.mjs";

export function dedupKeyFor({ tenantId, appId, entityType, object, dedupKeys } = {}) {
  const fields = dedupKeys?.[entityType] ?? [];
  if (!fields.length) {
    const error = new Error(`entitetstypen '${entityType}' mangler dedup-nøgler`);
    error.code = "missing_dedup_keys";
    throw error;
  }
  const values = fields.map((field) => {
    const value = object?.data?.[field];
    return { field, value: value === undefined ? null : value };
  });
  return digestOf({ tenantId, appId, entityType, values });
}

/**
 * Planlæg importen af ét kildeobjekt.
 *
 *   - `replay`    idempotency-nøglen er set før (samme kildeobjekt).
 *   - `conflict`  en anden kilde-post har samme forretningsidentitet; kræver
 *                 et menneske og flettes ikke.
 *   - `update`    posten findes allerede på sin stabile reference.
 *   - `create`    posten er ny.
 */
export function planImport({ store, source, object, dedupKey = null, idempotencyKey = null } = {}) {
  const reference = `mig:${source.tenantId}:${source.appId}:${object.entityType}:${object.sourceObjectId}`;
  if (idempotencyKey) {
    const replay = store.findIdempotency(source.tenantId, idempotencyKey);
    if (replay) return { action: "replay", reference: replay, dedupKey, existing: store.getRecord(replay) };
  }
  const key = dedupKey ?? dedupKeyFor({ tenantId: source.tenantId, appId: source.appId, entityType: object.entityType, object, dedupKeys: source.dedupKeys });
  const existingByDedup = store.findByDedupKey(source.tenantId, source.appId, object.entityType, key);
  if (existingByDedup && existingByDedup.reference !== reference) {
    return { action: "conflict", reference: existingByDedup.reference, dedupKey: key, existing: existingByDedup };
  }
  const existing = store.getRecord(reference);
  return { action: existing ? "update" : "create", reference, dedupKey: key, existing };
}

/** Kaster altid for forretningsposter: storage-dedup må ikke flette dem. */
export function mergeBusinessRecords() {
  return assertStorageDedupAllowed("business-records");
}
