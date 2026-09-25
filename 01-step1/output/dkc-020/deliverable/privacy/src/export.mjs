/**
 * DKC-020 — sikret eksport med udløb, modtagerbinding og revisionsspor.
 *
 * En eksport er ikke et link man kan dele frit. Den er bundet til:
 *
 *   - den tenant sagen tilhører (en fremmed tenant kan ikke indløse den),
 *   - en navngiven modtager (et link til en anden afvises),
 *   - et udløbstidspunkt (et udløbet link afvises og markeres `expired`),
 *   - et artefakt med en SHA-256, så en manuel ændring opdages ved indløsning.
 *
 * Kun subjektets egne poster følger med. Poster der tilhører en anden person
 * eller en fremmed tenant udelades og tælles, så eksporten kan være ærlig om
 * hvad der ikke blev udleveret.
 */
import { randomUUID } from "node:crypto";
import { filterSubjectRecords } from "./identity.mjs";
import { sha256 } from "./artifact-store.mjs";

export class ExportError extends Error {
  constructor(message, code = "export_forbidden") {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}

function flattenModuleRecords(modules = [], { tenantId, identifiers, subjectIds }) {
  const records = [];
  let dropped = 0;
  for (const entry of modules) {
    const filtered = filterSubjectRecords({ tenantId, identifiers, subjectIds, records: entry.records ?? [] });
    for (const value of filtered.records) records.push({ module: entry.module, value });
    dropped += filtered.dropped;
  }
  return { records, dropped };
}

/**
 * @param {object} config
 * @param {object} config.store          `createSqliteDsarStore(...)`
 * @param {object} config.artifactStore  `createMemoryArtifactStore()` eller tilsvarende
 * @param {Function} [config.audit]
 * @param {Function} [config.clock]
 * @param {number}  [config.ttlSeconds]
 */
export function createExportService({ store, artifactStore, audit = () => {}, clock = () => Date.now(), ttlSeconds = 3600 } = {}) {
  if (!store) throw new Error("createExportService kræver en store");
  if (!artifactStore) throw new Error("createExportService kræver en artifactStore");

  return {
    kind: "privacy-export-service",
    ttlSeconds,

    /**
     * Udsted en sikret eksport. `modules` er `[{ module, records }]` fra
     * kørslen. Returnerer eksportens metadata (ikke payloaden).
     */
    issue({ tenantId, caseId, verb, recipient, identifiers = [], subjectIds = [], modules = [], issuedBy = null, now = clock() } = {}) {
      if (!tenantId || !caseId || !recipient) throw new ExportError("issue kræver tenantId, caseId og recipient", "invalid_export");
      const exportId = randomUUID();
      const createdAt = new Date(now).toISOString();
      const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();
      const uri = `memory://dsar/${exportId}.json`;
      const { records, dropped } = flattenModuleRecords(modules, { tenantId, identifiers, subjectIds });
      const payload = {
        apiVersion: "contracts.platform/v1alpha1",
        kind: "PrivacyExportPayload",
        exportId,
        tenantId,
        caseId,
        verb,
        createdAt,
        expiresAt,
        recordCount: records.length,
        dropped,
        records,
      };
      const artifact = artifactStore.put(uri, payload);
      const auditRef = `audit:privacy.export.${exportId}`;
      const saved = store.createExport({ tenantId, exportId, caseId, verb, recipient, recordCount: records.length, artifact, auditRef, createdAt: now, expiresAt });
      audit({ type: "privacy.export.issued", tenantId, caseId, exportId, recipient: recipient.value ?? recipient, recordCount: records.length, dropped, issuedBy, auditRef });
      return saved;
    },

    /** Hent metadata uden at indløse linket. */
    get({ tenantId, exportId } = {}) {
      const exp = store.getExport(tenantId, exportId);
      if (!exp) throw new ExportError(`ukendt eksport '${exportId}'`, "export_not_found");
      return exp;
    },

    /**
     * Indløs eksporten. Afviser fremmed tenant, forkert modtager, tilbagekaldt,
     * allerede indløst og udløbet link. Verificerer artefaktets digest.
     */
    redeem({ tenantId, exportId, recipient, now = clock() } = {}) {
      const exp = store.getExport(tenantId, exportId);
      if (!exp) throw new ExportError(`ukendt eksport '${exportId}'`, "export_not_found");
      const recipientId = recipient?.value ?? recipient ?? null;
      if (!recipientId) throw new ExportError("indløsning kræver en modtager", "recipient_required");
      if (String(exp.tenantId) !== String(tenantId)) {
        audit({ type: "privacy.export.denied", tenantId, exportId, reason: "tenant_mismatch" });
        throw new ExportError("eksporten tilhører en anden tenant", "tenant_mismatch");
      }
      if (exp.status === "revoked") throw new ExportError("eksportlinket er tilbagekaldt", "export_revoked");
      if (exp.status === "redeemed") throw new ExportError("eksportlinket er allerede indløst", "export_redeemed");
      if (Date.parse(exp.expiresAt) <= now) {
        store.updateExport(tenantId, exportId, { status: "expired", now });
        audit({ type: "privacy.export.expired", tenantId, exportId });
        throw new ExportError("eksportlinket er udløbet", "export_expired");
      }
      if (String(exp.recipient) !== String(recipientId)) {
        audit({ type: "privacy.export.denied", tenantId, exportId, reason: "recipient_mismatch" });
        throw new ExportError("eksportlinket tilhører en anden modtager", "recipient_mismatch");
      }

      const raw = artifactStore.raw(exp.artifact.uri);
      if (raw === null) throw new ExportError("eksportartefaktet findes ikke", "artifact_missing");
      if (sha256(raw) !== exp.artifact.sha256) throw new ExportError("eksportartefaktets digest matcher ikke", "artifact_tampered");
      const payload = JSON.parse(raw);
      const updated = store.updateExport(tenantId, exportId, { status: "redeemed", redeemedAt: new Date(now).toISOString(), now });
      audit({ type: "privacy.export.redeemed", tenantId, exportId, recipient: recipientId, auditRef: exp.auditRef });
      return { ...updated, payload };
    },

    revoke({ tenantId, exportId, now = clock(), reason = null } = {}) {
      const exp = store.getExport(tenantId, exportId);
      if (!exp) throw new ExportError(`ukendt eksport '${exportId}'`, "export_not_found");
      const updated = store.updateExport(tenantId, exportId, { status: "revoked", revokedAt: new Date(now).toISOString(), now });
      audit({ type: "privacy.export.revoked", tenantId, exportId, reason });
      return updated;
    },
  };
}
