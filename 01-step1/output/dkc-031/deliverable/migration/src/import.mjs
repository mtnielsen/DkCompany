/**
 * DKC-031 — dry-run, resumable import og afstemning.
 *
 * En import er altid forudgået af en **dry-run**, der mapper hvert objekt,
 * klassificerer det (create/update/conflict/replay/fejl) og afstemmer antal og
 * checksums, før noget skrives. Importen er **resumable** gennem et checkpoint
 * og **idempotent** på en idempotency-nøgle, så en gentaget eller genoptaget
 * import ikke skaber dubletter. En dubleret forretningsidentitet bliver en
 * konflikt i fejllisten — aldrig en automatisk fletning.
 */
import { digestOf } from "../../runtime/src/digest.mjs";
import { mapSourceObject } from "./mapping.mjs";
import { dedupKeyFor, planImport } from "./dedup.mjs";
import { migrationReconciliationProblems } from "./model.mjs";

export class MigrationImportError extends Error {
  constructor(message, code = "migration_import_error") {
    super(message);
    this.name = "MigrationImportError";
    this.code = code;
  }
}

/** Den projicerede kerne af en post — det en dry-run og en import skal afstemme. */
export function projectionOf(record) {
  return {
    reference: record.reference,
    appId: record.appId,
    tenantId: record.tenantId,
    entityType: record.entityType,
    sourceObjectId: record.sourceObjectId,
    owner: record.owner,
    name: record.name,
    classification: record.classification,
    acl: record.acl,
    comments: record.comments,
    attachments: record.attachments,
    links: record.links,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function checksumOf(records) {
  const projections = records.map(projectionOf).sort((a, b) => a.reference.localeCompare(b.reference));
  return digestOf(projections);
}

function idempotencyKeyFor(source, object) {
  return `${source.id}:${object.entityType}:${object.sourceObjectId}`;
}

function conflictError(object, plan) {
  return {
    sourceObjectId: String(object.sourceObjectId),
    entityType: object.entityType,
    code: "dedup_conflict",
    message: `kildeobjektet '${object.sourceObjectId}' har samme forretningsidentitet som '${plan.existing?.reference}' og flettes ikke automatisk`,
    dedupKey: plan.dedupKey,
    existingReference: plan.existing?.reference ?? null,
  };
}

/**
 * Kør en dry-run. Skriver intet. Returnerer en afstemning med antal, checksums,
 * fejlliste, konflikter og den tabte funktionalitet for kilden.
 */
export function dryRun({ source, objects, coverage = null, at = "2026-03-01T00:00:00Z" } = {}) {
  const mapped = [];
  const errors = [];
  const conflicts = [];
  const counts = { source: objects.length, created: 0, updated: 0, conflicts: 0, skipped: 0, failed: 0 };
  const seen = new Map();

  for (const object of objects) {
    if (object.tenantId !== source.tenantId) {
      counts.failed += 1;
      errors.push({ sourceObjectId: String(object.sourceObjectId), entityType: object.entityType, code: "cross_tenant_object", message: `objektet tilhører '${object.tenantId}', ikke '${source.tenantId}'` });
      continue;
    }
    if (!(source.entityTypes ?? []).includes(object.entityType)) {
      counts.failed += 1;
      errors.push({ sourceObjectId: String(object.sourceObjectId), entityType: object.entityType, code: "unknown_entity", message: `entitetstypen '${object.entityType}' er ikke erklæret` });
      continue;
    }
    let record;
    let dedupKey;
    try {
      record = mapSourceObject({ source, object, at });
      dedupKey = dedupKeyFor({ tenantId: source.tenantId, appId: source.appId, entityType: object.entityType, object, dedupKeys: source.dedupKeys });
      record.dedupKey = dedupKey;
    } catch (error) {
      counts.failed += 1;
      errors.push({ sourceObjectId: String(object.sourceObjectId), entityType: object.entityType, code: error.code ?? "mapping_error", message: error.message });
      continue;
    }
    const prior = seen.get(dedupKey);
    if (prior && prior !== record.reference) {
      counts.conflicts += 1;
      conflicts.push(conflictError(object, { dedupKey, existing: { reference: prior } }));
      errors.push(conflictError(object, { dedupKey, existing: { reference: prior } }));
      continue;
    }
    seen.set(dedupKey, record.reference);
    counts.created += 1;
    mapped.push(record);
  }

  const sourceChecksum = checksumOf(mapped);
  const reconciliation = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationReconciliation",
    sourceId: source.id,
    appId: source.appId,
    tenantId: source.tenantId,
    mode: "dry-run",
    generatedAt: at,
    counts,
    checksums: { algorithm: "sha256", source: sourceChecksum, target: sourceChecksum, match: true },
    errors,
    conflicts,
    coverageLosses: (coverage?.lostFunctionality ?? []).filter((entry) => entry.appId === source.appId),
    checkpoint: null,
    persisted: false,
    problems: [],
  };
  reconciliation.problems = migrationReconciliationProblems(reconciliation);
  return reconciliation;
}

/** Importér ét objekt idempotent. Returnerer handlingen og den gemte post. */
export function importOne({ store, source, object, at = "2026-03-01T00:00:00Z" } = {}) {
  const record = mapSourceObject({ source, object, at });
  const dedupKey = dedupKeyFor({ tenantId: source.tenantId, appId: source.appId, entityType: object.entityType, object, dedupKeys: source.dedupKeys });
  record.dedupKey = dedupKey;
  const idempotencyKey = idempotencyKeyFor(source, object);
  const plan = planImport({ store, source, object, dedupKey, idempotencyKey });
  if (plan.action === "replay") return { action: "replay", record: plan.existing, idempotent: true };
  if (plan.action === "conflict") {
    const conflict = conflictError(object, plan);
    store.appendError(source.id, conflict);
    return { action: "conflict", record: plan.existing, conflict };
  }
  const existing = store.getRecord(record.reference);
  record.version = existing ? existing.version + 1 : 1;
  record.createdAt = existing?.createdAt ?? record.createdAt;
  store.upsertRecord(record, { at });
  store.recordIdempotency(source.tenantId, idempotencyKey, record.reference);
  return { action: existing ? "update" : "create", record, idempotent: false };
}

/**
 * Importér en liste af objekter resumabelt. Et `limit` standser bevidst efter
 * N objekter og gemmer et checkpoint, så et efterfølgende kald med `resume`
 * fortsætter uden at gentage noget. Returnerer en afstemning for hele kørslen.
 */
export function importBatch({ store, source, objects, coverage = null, at = "2026-03-01T00:00:00Z", limit = null, resume = true } = {}) {
  const previous = resume ? store.getCheckpoint(source.id) : null;
  const completed = new Set(previous?.completed ?? []);
  const counts = { source: objects.length, created: 0, updated: 0, conflicts: 0, skipped: 0, failed: 0 };
  const errors = [];
  const conflicts = [];
  let processedThisRun = 0;

  for (const object of objects) {
    if (completed.has(String(object.sourceObjectId))) {
      counts.skipped += 1;
      continue;
    }
    if (limit !== null && processedThisRun >= limit) break;
    if (object.tenantId !== source.tenantId || !(source.entityTypes ?? []).includes(object.entityType)) {
      counts.failed += 1;
      const entry = { sourceObjectId: String(object.sourceObjectId), entityType: object.entityType, code: object.tenantId !== source.tenantId ? "cross_tenant_object" : "unknown_entity", message: `objektet kan ikke importeres` };
      errors.push(entry);
      store.appendError(source.id, entry);
      continue;
    }
    let result;
    try {
      result = importOne({ store, source, object, at });
    } catch (error) {
      counts.failed += 1;
      const entry = { sourceObjectId: String(object.sourceObjectId), entityType: object.entityType, code: error.code ?? "import_error", message: error.message };
      errors.push(entry);
      store.appendError(source.id, entry);
      processedThisRun += 1;
      continue;
    }
    processedThisRun += 1;
    completed.add(String(object.sourceObjectId));
    if (result.action === "conflict") {
      counts.conflicts += 1;
      conflicts.push(result.conflict);
    } else if (result.action === "replay") {
      counts.skipped += 1;
    } else if (result.action === "update") {
      counts.updated += 1;
    } else {
      counts.created += 1;
    }
  }

  const checkpoint = {
    sourceId: source.id,
    completed: [...completed].sort(),
    nextIndex: completed.size,
    at,
  };
  store.saveCheckpoint(source.id, checkpoint);

  const mapped = objects
    .filter((object) => completed.has(String(object.sourceObjectId)))
    .flatMap((object) => {
      try {
        const record = mapSourceObject({ source, object, at });
        record.dedupKey = dedupKeyFor({ tenantId: source.tenantId, appId: source.appId, entityType: object.entityType, object, dedupKeys: source.dedupKeys });
        return [record];
      } catch {
        return [];
      }
    });
  const stored = store.listRecords({ tenantId: source.tenantId, appId: source.appId });
  const reconciliation = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationReconciliation",
    sourceId: source.id,
    appId: source.appId,
    tenantId: source.tenantId,
    mode: "import",
    generatedAt: at,
    counts,
    checksums: { algorithm: "sha256", source: checksumOf(mapped), target: checksumOf(stored), match: checksumOf(mapped) === checksumOf(stored) },
    errors,
    conflicts,
    coverageLosses: (coverage?.lostFunctionality ?? []).filter((entry) => entry.appId === source.appId),
    checkpoint,
    persisted: true,
    problems: [],
  };
  reconciliation.problems = migrationReconciliationProblems(reconciliation);
  return reconciliation;
}

/** Afstem den gemte tilstand mod kildens forventede projektion. */
export function reconcile({ store, source, objects, coverage = null, at = "2026-03-01T00:00:00Z" } = {}) {
  const mapped = objects
    .filter((object) => object.tenantId === source.tenantId && (source.entityTypes ?? []).includes(object.entityType))
    .flatMap((object) => {
      try {
        const record = mapSourceObject({ source, object, at });
        record.dedupKey = dedupKeyFor({ tenantId: source.tenantId, appId: source.appId, entityType: object.entityType, object, dedupKeys: source.dedupKeys });
        return [record];
      } catch {
        return [];
      }
    });
  const stored = store.listRecords({ tenantId: source.tenantId, appId: source.appId });
  const counts = {
    source: mapped.length,
    created: stored.length,
    updated: 0,
    conflicts: store.listErrors(source.id).filter((e) => e.code === "dedup_conflict").length,
    skipped: 0,
    failed: store.listErrors(source.id).filter((e) => e.code !== "dedup_conflict").length,
  };
  const reconciliation = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationReconciliation",
    sourceId: source.id,
    appId: source.appId,
    tenantId: source.tenantId,
    mode: "import",
    generatedAt: at,
    counts,
    checksums: { algorithm: "sha256", source: checksumOf(mapped), target: checksumOf(stored), match: checksumOf(mapped) === checksumOf(stored) },
    errors: store.listErrors(source.id),
    conflicts: store.listErrors(source.id).filter((e) => e.code === "dedup_conflict"),
    coverageLosses: (coverage?.lostFunctionality ?? []).filter((entry) => entry.appId === source.appId),
    checkpoint: store.getCheckpoint(source.id),
    persisted: true,
    problems: [],
  };
  reconciliation.problems = migrationReconciliationProblems(reconciliation);
  return reconciliation;
}
