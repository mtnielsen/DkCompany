/**
 * DKC-030 — import, opdatering og eksport med stabil reference.
 *
 * Importen er idempotent på en idempotency-nøgle, og en post findes/genbruges
 * på sin forretningsidentitet (dedup-nøgle). Et retry returnerer den samme
 * post. To forskellige upstream-poster med samme forretningsidentitet flettes
 * aldrig automatisk — det er en konflikt der kræver et menneske (DKC-043).
 * Eksporten bevarer den stabile, tenantafgrænsede reference og inkluderer
 * aktiviteter.
 */
import { mapEspocrmRecord } from "./espocrm.mjs";
import { buildReference, assertReferenceTenant } from "./references.mjs";
import { dedupKeyFor, planImport } from "./dedup.mjs";
import { decideRecordAccess } from "./permissions.mjs";

export class CrmSyncError extends Error {
  constructor(message, code = "crm_sync_error", status = 400) {
    super(message);
    this.name = "CrmSyncError";
    this.code = code;
    this.status = status;
  }
}

function termsFor(record) {
  return `${record.name ?? ""} ${JSON.stringify(record.data ?? {})}`
    .toLowerCase()
    .replace(/[^a-z0-9æøåäöüß]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Spejl én upstream-post ind i butikken (dubletkonflikter flettes ikke). */
export function importUpstreamRecord({ store, source, upstreamRecord, entityType, at = null } = {}) {
  if (!source.entityTypes.includes(entityType)) throw new CrmSyncError(`entitetstypen '${entityType}' er ikke erklæret for '${source.id}'`, "unknown_entity");
  const mapped = mapEspocrmRecord(upstreamRecord, { source, entityType });
  const plan = planImport({ store, reference: mapped.reference, tenantId: source.tenantId, entityType, record: upstreamRecord, dedupKeys: source.dedupKeys });
  if (plan.action === "conflict") {
    store.appendActivity({ reference: mapped.reference, type: "record.dedup_conflict", subject: mapped.name, actor: "platform:dedup", detail: { dedupKey: plan.dedupKey, existingReference: plan.existing.reference }, at: at ?? new Date().toISOString() });
    return { record: plan.existing, action: "conflict", conflict: { dedupKey: plan.dedupKey, existingReference: plan.existing.reference }, deduplicated: false };
  }
  const existing = store.getRecord(mapped.reference);
  const record = {
    ...mapped,
    createdAt: existing?.createdAt ?? (at ?? mapped.createdAt),
    updatedAt: existing ? (at ?? new Date().toISOString()) : (at ?? mapped.updatedAt),
    copies: existing?.copies ?? [],
  };
  store.upsertRecord(record, { at });
  store.indexRecord(record.id, { terms: termsFor(record) });
  store.appendActivity({ reference: record.id, type: existing ? "record.updated" : "record.created", subject: record.name, actor: "platform:sync", detail: { version: record.version }, at: at ?? new Date().toISOString() });
  return { record, action: plan.action, deduplicated: false };
}

/** Spejl hele upstream for én entitetstype. */
export async function syncUpstream({ store, source, client, entityType, at = null } = {}) {
  const listing = await client.list(entityType);
  const list = Array.isArray(listing) ? listing : listing?.list ?? [];
  const results = [];
  for (const upstreamRecord of list) {
    results.push(importUpstreamRecord({ store, source, upstreamRecord, entityType, at }));
  }
  return { entityType, total: list.length, created: results.filter((r) => r.action === "create").length, updated: results.filter((r) => r.action === "update").length, conflicts: results.filter((r) => r.action === "conflict").length, results };
}

/**
 * Importér en platformspost gennem adapteren. Idempotent på idempotency-nøglen;
 * findes posten allerede på sin forretningsidentitet, opdateres den i stedet
 * for at oprette en ny.
 */
export async function importRecord({ store, source, client, entityType, payload, idempotencyKey, at = null } = {}) {
  if (!idempotencyKey) throw new CrmSyncError("importen kræver en idempotency-nøgle", "missing_idempotency_key");
  if (!source.entityTypes.includes(entityType)) throw new CrmSyncError(`entitetstypen '${entityType}' er ikke erklæret for '${source.id}'`, "unknown_entity");
  const existingByKey = store.findIdempotency(source.tenantId, idempotencyKey);
  if (existingByKey) {
    return { record: store.getRecord(existingByKey), action: "replay", idempotent: true, deduplicated: false };
  }

  // En post skal have et entydigt ejerskab; mangler importen et, bruges kildens standardejer.
  const enriched = { ...payload };
  if (!enriched[source.ownerField]) {
    if (!source.defaultOwner) throw new CrmSyncError("posten mangler et ejerskab, og kilden har ingen standardejer", "missing_owner");
    enriched[source.ownerField] = source.defaultOwner;
  }

  const dedupKey = dedupKeyFor({ tenantId: source.tenantId, entityType, record: enriched, dedupKeys: source.dedupKeys });
  const existingByDedup = store.findByDedupKey(source.tenantId, entityType, dedupKey);

  let upstream;
  let action;
  if (existingByDedup) {
    upstream = await client.update(entityType, existingByDedup.upstreamId, enriched);
    action = "update";
  } else {
    upstream = await client.create(entityType, enriched, { idempotencyKey });
    action = "create";
  }
  const reference = buildReference({ tenantId: source.tenantId, entityType, upstreamId: upstream.id });
  assertReferenceTenant(reference, source.tenantId);

  const mapped = mapEspocrmRecord(upstream, { source, entityType });
  const existing = store.getRecord(mapped.reference);
  const record = {
    ...mapped,
    createdAt: existingByDedup?.createdAt ?? existing?.createdAt ?? (at ?? mapped.createdAt),
    updatedAt: at ?? new Date().toISOString(),
    copies: existingByDedup?.copies ?? existing?.copies ?? [],
  };
  store.upsertRecord(record, { at });
  store.indexRecord(record.id, { terms: termsFor(record) });
  store.recordIdempotency(source.tenantId, idempotencyKey, record.id);
  store.appendActivity({ reference: record.id, type: existingByDedup ? "record.updated" : "record.created", subject: record.name, actor: "platform:import", detail: { idempotencyKey, dedupKey }, at: at ?? new Date().toISOString() });
  return { record, action, idempotent: false, deduplicated: false };
}

/** Eksportér én post med stabil reference og aktiviteter (kræver læseadgang). */
export function exportRecord({ store, reference, principal, source = null } = {}) {
  const record = store.getRecord(reference);
  if (!record) throw new CrmSyncError(`posten '${reference}' findes ikke`, "not_found");
  const decision = decideRecordAccess({ principal, record, source });
  if (!decision.allowed) throw new CrmSyncError(`eksport nægtet (${decision.reason})`, "access_denied", 403);
  const activities = store.listActivities(record.id);
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "CrmExport",
    tenantId: record.tenantId,
    generatedAt: new Date().toISOString(),
    record,
    activities,
    activityCount: activities.length,
  };
}

/** Eksportér alle autoriserede poster i en tenant. */
export function exportTenant({ store, tenantId, principal, source = null } = {}) {
  const records = store.listRecords({ tenantId }).filter((record) => decideRecordAccess({ principal, record, source }).allowed);
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "CrmExport",
    tenantId,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    records: records.map((record) => ({ reference: record.reference, entityType: record.entityType, name: record.name, owner: record.owner, version: record.version })),
    activities: store.listActivities().filter((a) => records.some((r) => r.id === a.reference)),
  };
}
