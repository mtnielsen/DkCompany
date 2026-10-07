/**
 * DKC-019 — holdbart dataregister, retention og holds.
 *
 * Registeret gemmes pr. tenant som en versioneret fil med en SHA-256-digest.
 * Hver post normaliseres i `data_register_entries` sammen med sit blocker-antal,
 * så en persondatapost uden ejerbeslutning, aftale eller tredjelandsvurdering
 * kan findes og rapporteres uden at parse hele dokumentet. Slettefrister og
 * subprocessorer gemmes hver for sig, og et aktivt hold blokerer sletning.
 *
 * Adapteren er tenant-bundet: hver metode normaliserer tenant-id'et og
 * filtrerer eksplicit på `tenant_id`, så en fremmed tenant ikke kan læse eller
 * skrive en andens register. Tjenestelaget ovenover håndhæver autorisationen.
 */
import { createHash } from "node:crypto";
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";
import { entryBlockers, isPersonalEntry } from "../../../conformance/src/data-register.mjs";

export class DataRegisterError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataRegisterError";
  }
}

/** Deterministisk JSON (sorterede nøgler), så digesten er reproducerbar. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function digestOf(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function createSqliteDataRegisterStore({ db, clock = () => Date.now(), kind = "sqlite-data-register-store" } = {}) {
  if (!db) throw new Error("createSqliteDataRegisterStore kræver en database");

  const upsertVersion = db.prepare(`INSERT INTO data_register_versions(
      version_id, tenant_id, register_name, register_version, digest, document, created_at, created_by, approved_at, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(version_id) DO UPDATE SET
      digest = excluded.digest, document = excluded.document, created_at = excluded.created_at,
      created_by = excluded.created_by, approved_at = excluded.approved_at, approved_by = excluded.approved_by`);
  const getVersion = db.prepare("SELECT * FROM data_register_versions WHERE version_id = ? AND tenant_id = ?");
  const listVersions = db.prepare("SELECT version_id, tenant_id, register_name, register_version, digest, created_at, created_by, approved_at, approved_by FROM data_register_versions WHERE tenant_id = ? ORDER BY created_at DESC");

  const upsertEntry = db.prepare(`INSERT INTO data_register_entries(
      tenant_id, entry_id, register_version, status, owner_subject, owner_name, module_ref, route_ref,
      personal, legal_basis_status, legal_basis_ground, has_contract, transfer_assessed, blocker_count, document, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, entry_id) DO UPDATE SET
      register_version = excluded.register_version, status = excluded.status, owner_subject = excluded.owner_subject,
      owner_name = excluded.owner_name, module_ref = excluded.module_ref, route_ref = excluded.route_ref,
      personal = excluded.personal, legal_basis_status = excluded.legal_basis_status, legal_basis_ground = excluded.legal_basis_ground,
      has_contract = excluded.has_contract, transfer_assessed = excluded.transfer_assessed, blocker_count = excluded.blocker_count,
      document = excluded.document, updated_at = excluded.updated_at`);
  const getEntryStmt = db.prepare("SELECT * FROM data_register_entries WHERE tenant_id = ? AND entry_id = ?");
  const listEntriesStmt = db.prepare("SELECT * FROM data_register_entries WHERE tenant_id = ? ORDER BY entry_id");
  const listBlockersStmt = db.prepare("SELECT * FROM data_register_entries WHERE tenant_id = ? AND blocker_count > 0 ORDER BY entry_id");

  const upsertRetention = db.prepare(`INSERT INTO data_register_retention(
      tenant_id, entry_id, policy_id, version, purpose_ref, max_days, trigger, legal_hold_supported, approved_by, approved_at, document, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, entry_id) DO UPDATE SET
      policy_id = excluded.policy_id, version = excluded.version, purpose_ref = excluded.purpose_ref, max_days = excluded.max_days,
      trigger = excluded.trigger, legal_hold_supported = excluded.legal_hold_supported, approved_by = excluded.approved_by,
      approved_at = excluded.approved_at, document = excluded.document, updated_at = excluded.updated_at`);
  const listRetentionStmt = db.prepare("SELECT * FROM data_register_retention WHERE tenant_id = ? ORDER BY entry_id");

  const upsertSubprocessor = db.prepare(`INSERT INTO data_register_subprocessors(
      tenant_id, subprocessor_id, name, hosting_region, dpa_ref, contract_ref, third_country_status, document, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, subprocessor_id) DO UPDATE SET
      name = excluded.name, hosting_region = excluded.hosting_region, dpa_ref = excluded.dpa_ref,
      contract_ref = excluded.contract_ref, third_country_status = excluded.third_country_status,
      document = excluded.document, updated_at = excluded.updated_at`);
  const listSubprocessorsStmt = db.prepare("SELECT * FROM data_register_subprocessors WHERE tenant_id = ? ORDER BY subprocessor_id");

  const insertHold = db.prepare(`INSERT INTO data_register_holds(
      hold_id, tenant_id, entry_id, reason, placed_by, placed_at, released_at, released_by, document)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`);
  const getHoldStmt = db.prepare("SELECT * FROM data_register_holds WHERE hold_id = ? AND tenant_id = ?");
  const listHoldsStmt = db.prepare("SELECT * FROM data_register_holds WHERE tenant_id = ? AND entry_id = ? ORDER BY placed_at DESC");
  const releaseHoldStmt = db.prepare("UPDATE data_register_holds SET released_at = ?, released_by = ? WHERE hold_id = ? AND tenant_id = ? AND released_at IS NULL");
  const activeHoldStmt = db.prepare("SELECT hold_id FROM data_register_holds WHERE tenant_id = ? AND entry_id = ? AND released_at IS NULL LIMIT 1");

  function entryRecord(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      entryId: row.entry_id,
      registerVersion: row.register_version,
      status: row.status,
      owner: { subject: row.owner_subject, name: row.owner_name },
      moduleRef: row.module_ref,
      routeRef: row.route_ref,
      personal: row.personal === 1,
      legalBasisStatus: row.legal_basis_status,
      legalBasisGround: row.legal_basis_ground,
      hasContract: row.has_contract === 1,
      transferAssessed: row.transfer_assessed === 1,
      blockerCount: row.blocker_count,
      updatedAt: row.updated_at,
      document: JSON.parse(row.document),
    };
  }

  function versionRecord(row) {
    if (!row) return null;
    return {
      versionId: row.version_id,
      tenantId: row.tenant_id,
      registerName: row.register_name,
      registerVersion: row.register_version,
      digest: row.digest,
      createdAt: row.created_at,
      createdBy: row.created_by,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      document: JSON.parse(row.document),
    };
  }

  return {
    kind,
    /** Gem en hel registerversion atomisk (version + poster + retention + subprocessorer). */
    saveVersion(tenantId, register, { createdBy = null, approvedBy = null, versionId = null } = {}) {
      if (!register?.metadata?.name || !register?.metadata?.version) {
        throw new DataRegisterError("registeret skal have metadata.name og metadata.version");
      }
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const id = versionId ?? `${tenant}:${register.metadata.name}:${register.metadata.version}`;
      const digest = digestOf(register);
      return db.transaction(() => {
        upsertVersion.run(id, tenant, register.metadata.name, register.metadata.version, digest, canonicalJson(register), at, createdBy, approvedBy ? at : null, approvedBy);
        for (const entry of register.entries ?? []) {
          const personal = isPersonalEntry(entry) ? 1 : 0;
          const blockers = entryBlockers(entry);
          const hasContract = entry.roles?.controller?.contractRef && entry.roles?.processor?.contractRef ? 1 : 0;
          const transferAssessed = entry.location?.thirdCountryTransfer?.assessed === true ? 1 : 0;
          upsertEntry.run(
            tenant, entry.id, register.metadata.version, entry.status, entry.owner?.subject ?? "", entry.owner?.name ?? "",
            entry.moduleRef ?? null, entry.routeRef ?? null, personal, entry.legalBasis?.status ?? "",
            entry.legalBasis?.ground ?? null, hasContract, transferAssessed, blockers.length, JSON.stringify(entry), at
          );
          if (entry.retention) {
            upsertRetention.run(
              tenant, entry.id, entry.retention.policyId, entry.retention.version, entry.retention.purposeRef,
              entry.retention.maxDays, entry.retention.trigger, entry.retention.legalHold?.supported ? 1 : 0,
              entry.retention.approvedBy?.subject ?? "", entry.retention.approvedAt ?? "", JSON.stringify(entry.retention), at
            );
          }
        }
        for (const sp of register.subprocessors ?? []) {
          upsertSubprocessor.run(tenant, sp.id, sp.name, sp.hostingRegion, sp.dpaRef, sp.contractRef, sp.thirdCountryTransfer?.status ?? "undetermined", JSON.stringify(sp), at);
        }
        return { versionId: id, digest, entryCount: (register.entries ?? []).length, subprocessorCount: (register.subprocessors ?? []).length };
      });
    },
    getVersion(tenantId, versionId) {
      return versionRecord(getVersion.get(versionId, normalizeTenantId(tenantId)));
    },
    listVersions(tenantId) {
      return listVersions.all(normalizeTenantId(tenantId)).map((r) => ({
        versionId: r.version_id,
        registerName: r.register_name,
        registerVersion: r.register_version,
        digest: r.digest,
        createdAt: r.created_at,
        createdBy: r.created_by,
        approvedAt: r.approved_at,
        approvedBy: r.approved_by,
      }));
    },
    getEntry(tenantId, entryId) {
      return entryRecord(getEntryStmt.get(normalizeTenantId(tenantId), entryId));
    },
    listEntries(tenantId) {
      return listEntriesStmt.all(normalizeTenantId(tenantId)).map(entryRecord);
    },
    listSubprocessors(tenantId) {
      return listSubprocessorsStmt.all(normalizeTenantId(tenantId)).map((r) => ({ ...JSON.parse(r.document), updatedAt: r.updated_at }));
    },
    listRetention(tenantId) {
      return listRetentionStmt.all(normalizeTenantId(tenantId)).map((r) => ({ ...JSON.parse(r.document), entryId: r.entry_id, updatedAt: r.updated_at }));
    },
    /** Poster med aktive blockere (persondata uden ejerbeslutning/aftale/vurdering). */
    listBlockers(tenantId) {
      return listBlockersStmt.all(normalizeTenantId(tenantId)).map(entryRecord);
    },
    placeHold(tenantId, { entryId, reason, placedBy, holdId = null } = {}) {
      if (!entryId) throw new DataRegisterError("placeHold kræver et entryId");
      if (!reason) throw new DataRegisterError("placeHold kræver en begrundelse");
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const id = holdId ?? `${tenant}:${entryId}:${at}`;
      db.transaction(() => insertHold.run(id, tenant, entryId, reason, placedBy ?? "unknown", at, JSON.stringify({ holdId: id, tenantId: tenant, entryId, reason, placedBy, placedAt: at })));
      return { holdId: id, tenantId: tenant, entryId, reason, placedBy, placedAt: at, releasedAt: null };
    },
    releaseHold(tenantId, holdId, { releasedBy = "unknown" } = {}) {
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const result = db.transaction(() => releaseHoldStmt.run(at, releasedBy, holdId, tenant));
      return { holdId, tenantId: tenant, releasedAt: at, releasedBy, changed: result.changes > 0 };
    },
    listHolds(tenantId, entryId) {
      return listHoldsStmt.all(normalizeTenantId(tenantId), entryId).map((r) => ({ ...JSON.parse(r.document), releasedAt: r.released_at, releasedBy: r.released_by }));
    },
    hasActiveHold(tenantId, entryId) {
      return Boolean(activeHoldStmt.get(normalizeTenantId(tenantId), entryId));
    },
  };
}
