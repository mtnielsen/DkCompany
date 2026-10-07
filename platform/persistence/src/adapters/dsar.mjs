/**
 * DKC-020 — holdbar DSAR-sag med per-modul status og sikret eksport.
 *
 * Adapteren er den vedvarende kerne under `privacy/`. Den gemmer:
 *
 *   - selve sagen (`dsar_cases`) med den autoriserede sagsbehandler, deadline,
 *     status og den seneste `PrivacySubjectResponse`,
 *   - per-modul resultatet (`dsar_module_results`), som er den genoptagelige
 *     arbejdsenhed: et allerede afsluttet modul køres ikke igen,
 *   - sikrede eksporter (`dsar_exports`) med modtager, udløb, digest og
 *     revisionsreference. Payloaden ligger i artefaktet, ikke i registeret.
 *
 * Adapteren er tenant-bundet: hver metode normaliserer tenant-id'et og
 * filtrerer eksplicit på `tenant_id`, så en fremmed tenant ikke kan læse eller
 * skrive en andens sag. Autorisationen håndhæves af tjenestelaget ovenover.
 */
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

export class DsarError extends Error {
  constructor(message, code = "dsar_error") {
    super(message);
    this.name = "DsarError";
    this.code = code;
  }
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function parseJson(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

export function createSqliteDsarStore({ db, clock = () => Date.now(), kind = "sqlite-dsar-store" } = {}) {
  if (!db) throw new Error("createSqliteDsarStore kræver en database");

  const insertCase = db.prepare(`INSERT INTO dsar_cases(
      tenant_id, case_id, verb, subject_identifiers, requested_by, caseworker, status, legal_basis,
      deadline, idempotency_key, response, export_id, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`);
  const getCaseStmt = db.prepare("SELECT * FROM dsar_cases WHERE tenant_id = ? AND case_id = ?");
  const getIdemStmt = db.prepare("SELECT * FROM dsar_cases WHERE tenant_id = ? AND idempotency_key = ?");
  const listCasesStmt = db.prepare("SELECT * FROM dsar_cases WHERE tenant_id = ? ORDER BY created_at DESC, case_id");
  const listByStatusStmt = db.prepare("SELECT * FROM dsar_cases WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC, case_id");
  const updateCaseStmt = db.prepare(`UPDATE dsar_cases SET status = ?, response = ?, export_id = ?, completed_at = ?, updated_at = ?
    WHERE tenant_id = ? AND case_id = ?`);

  const upsertResult = db.prepare(`INSERT INTO dsar_module_results(
      tenant_id, case_id, module, module_version, verb, status, records_affected, matched, reason, error,
      artifact_ref, artifact_sha256, duration_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, case_id, module) DO UPDATE SET
      module_version = excluded.module_version, verb = excluded.verb, status = excluded.status,
      records_affected = excluded.records_affected, matched = excluded.matched, reason = excluded.reason,
      error = excluded.error, artifact_ref = excluded.artifact_ref, artifact_sha256 = excluded.artifact_sha256,
      duration_ms = excluded.duration_ms, updated_at = excluded.updated_at`);
  const listResultsStmt = db.prepare("SELECT * FROM dsar_module_results WHERE tenant_id = ? AND case_id = ? ORDER BY module");
  const getResultStmt = db.prepare("SELECT * FROM dsar_module_results WHERE tenant_id = ? AND case_id = ? AND module = ?");

  const insertExport = db.prepare(`INSERT INTO dsar_exports(
      tenant_id, export_id, case_id, verb, recipient, status, record_count, artifact, audit_ref,
      created_at, expires_at, redeemed_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, NULL)`);
  const getExportStmt = db.prepare("SELECT * FROM dsar_exports WHERE tenant_id = ? AND export_id = ?");
  const listExportsStmt = db.prepare("SELECT * FROM dsar_exports WHERE tenant_id = ? AND case_id = ? ORDER BY created_at");
  const updateExportStmt = db.prepare("UPDATE dsar_exports SET status = ?, redeemed_at = ?, revoked_at = ? WHERE tenant_id = ? AND export_id = ?");

  function parseCase(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      caseId: row.case_id,
      verb: row.verb,
      identifiers: parseJson(row.subject_identifiers),
      requestedBy: parseJson(row.requested_by),
      caseworker: parseJson(row.caseworker),
      status: row.status,
      legalBasis: row.legal_basis,
      deadline: row.deadline,
      idempotencyKey: row.idempotency_key,
      response: parseJson(row.response),
      exportId: row.export_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  function parseResult(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      caseId: row.case_id,
      module: row.module,
      moduleVersion: row.module_version,
      verb: row.verb,
      status: row.status,
      recordsAffected: row.records_affected,
      matched: row.matched === null || row.matched === undefined ? null : Boolean(row.matched),
      reason: row.reason,
      error: row.error,
      artifactRef: row.artifact_ref,
      artifactSha256: row.artifact_sha256,
      durationMs: row.duration_ms,
      updatedAt: row.updated_at,
    };
  }

  function parseExport(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      exportId: row.export_id,
      caseId: row.case_id,
      verb: row.verb,
      recipient: row.recipient,
      status: row.status,
      recordCount: row.record_count,
      artifact: parseJson(row.artifact),
      auditRef: row.audit_ref,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      redeemedAt: row.redeemed_at,
      revokedAt: row.revoked_at,
    };
  }

  return {
    kind,

    createCase({ tenantId, caseId, verb, identifiers, requestedBy, caseworker, status = "open", legalBasis = null, deadline = null, idempotencyKey = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      if (!caseId) throw new DsarError("createCase kræver caseId");
      if (idempotencyKey) {
        const existing = parseCase(getIdemStmt.get(tenant, idempotencyKey));
        if (existing) return { ...existing, replayed: true };
      }
      const at = iso(now);
      insertCase.run(tenant, caseId, verb, JSON.stringify(identifiers ?? []), JSON.stringify(requestedBy ?? null), JSON.stringify(caseworker ?? null), status, legalBasis, deadline, idempotencyKey, at, at);
      return parseCase(getCaseStmt.get(tenant, caseId));
    },

    getCase: (tenantId, caseId) => parseCase(getCaseStmt.get(normalizeTenantId(tenantId), caseId)),
    getCaseByIdempotencyKey: (tenantId, key) => parseCase(getIdemStmt.get(normalizeTenantId(tenantId), key)),
    listCases: (tenantId, { status = null } = {}) => {
      const tenant = normalizeTenantId(tenantId);
      const rows = status ? listByStatusStmt.all(tenant, status) : listCasesStmt.all(tenant);
      return rows.map(parseCase);
    },

    updateCase(tenantId, caseId, { status, response = null, exportId = null, completedAt = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const current = parseCase(getCaseStmt.get(tenant, caseId));
      if (!current) throw new DsarError(`ukendt sag '${caseId}'`, "case_not_found");
      const nextResponse = response === null ? (current.response === null ? null : JSON.stringify(current.response)) : JSON.stringify(response);
      updateCaseStmt.run(status ?? current.status, nextResponse, exportId ?? current.exportId, completedAt ?? current.completedAt, iso(now), tenant, caseId);
      return parseCase(getCaseStmt.get(tenant, caseId));
    },

    upsertModuleResult(tenantId, result = {}) {
      const tenant = normalizeTenantId(tenantId);
      const {
        caseId, module, moduleVersion = null, verb, status, recordsAffected = null, matched = null,
        reason = null, error = null, artifactRef = null, artifactSha256 = null, durationMs = null, now = clock(),
      } = result;
      if (!caseId || !module || !verb) throw new DsarError("upsertModuleResult kræver caseId, module og verb");
      upsertResult.run(tenant, caseId, module, moduleVersion, verb, status, recordsAffected, matched === null ? null : matched ? 1 : 0, reason, error, artifactRef, artifactSha256, durationMs, iso(now));
      return parseResult(getResultStmt.get(tenant, caseId, module));
    },

    listModuleResults: (tenantId, caseId) => listResultsStmt.all(normalizeTenantId(tenantId), caseId).map(parseResult),

    createExport({ tenantId, exportId, caseId, verb, recipient, recordCount, artifact, auditRef = null, createdAt = clock(), expiresAt } = {}) {
      const tenant = normalizeTenantId(tenantId);
      if (!exportId || !caseId || !expiresAt) throw new DsarError("createExport kræver exportId, caseId og expiresAt");
      insertExport.run(tenant, exportId, caseId, verb, recipient, recordCount, JSON.stringify(artifact), auditRef, iso(createdAt), expiresAt);
      return parseExport(getExportStmt.get(tenant, exportId));
    },

    getExport: (tenantId, exportId) => parseExport(getExportStmt.get(normalizeTenantId(tenantId), exportId)),
    listExports: (tenantId, caseId) => listExportsStmt.all(normalizeTenantId(tenantId), caseId).map(parseExport),

    updateExport(tenantId, exportId, { status, redeemedAt = undefined, revokedAt = undefined, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const current = parseExport(getExportStmt.get(tenant, exportId));
      if (!current) throw new DsarError(`ukendt eksport '${exportId}'`, "export_not_found");
      const nextRedeemed = redeemedAt === undefined ? current.redeemedAt : redeemedAt;
      const nextRevoked = revokedAt === undefined ? current.revokedAt : revokedAt;
      updateExportStmt.run(status ?? current.status, nextRedeemed, nextRevoked, tenant, exportId);
      return parseExport(getExportStmt.get(tenant, exportId));
    },

    countCases(tenantId) {
      return db.get("SELECT COUNT(*) AS n FROM dsar_cases WHERE tenant_id = ?", normalizeTenantId(tenantId)).n;
    },
  };
}
