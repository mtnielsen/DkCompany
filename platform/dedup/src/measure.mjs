/**
 * DKC-043 — måling og besparelsesgate.
 *
 * Besparelsen fra dedup er kun meningsfuld hvis dataene stadig kan læses
 * fuldt ud. Denne modul måler logiske og fysiske bytes og aktiverer først
 * besparelsen når både en integritetskontrol (scrub af alle chunks) og en fuld
 * restore (genforening og digest-verifikation af hvert snapshot) består. Ellers
 * rapporteres besparelsen som inaktiv med den præcise grund — der er ingen
 * "grøn" besparelse uden bevis.
 */
import { sha256Hex } from "./chunker.mjs";
import { normalizeDedupDomain } from "./store.mjs";

/** Kør integritets- og restoretest og afgør om besparelsen må aktiveres. */
export function evaluateSavingsGate({ store, domain: domainRaw, snapshotIds = [], now = Date.now() } = {}) {
  if (!store) throw new Error("evaluateSavingsGate kræver et dedup-lager");
  const domain = normalizeDedupDomain(domainRaw);
  const integrity = store.scrub({ domain });
  const restores = [];
  let restoreOk = true;
  for (const snapshotId of snapshotIds) {
    try {
      const buffer = store.readSnapshot({ domain, snapshotId });
      restores.push({ snapshotId, ok: true, bytes: buffer.length, sha256: sha256Hex(buffer) });
    } catch (error) {
      restoreOk = false;
      restores.push({ snapshotId, ok: false, bytes: 0, sha256: null, error: error.code ?? error.message });
    }
  }
  const measurement = store.measure({ domain });
  const savingsActive = integrity.ok && restoreOk;
  const reasons = [];
  if (!integrity.ok) reasons.push(`integritetskontrol fejlede for ${integrity.corruptions.length} chunk(s)`);
  if (!restoreOk) reasons.push("fuld restore fejlede");
  return {
    savingsActive,
    reasons,
    integrity: { checked: integrity.checked, ok: integrity.ok, corruptions: integrity.corruptions, affectedSnapshots: integrity.affectedSnapshots },
    restore: { ok: restoreOk, snapshots: restores.sort((a, b) => a.snapshotId.localeCompare(b.snapshotId)) },
    measurement,
    domain,
    evaluatedAt: new Date(now).toISOString(),
  };
}

/** Byg en receipt der kan valideres mod `contracts/dedup-receipt.schema.json`. */
export function buildDedupReceipt({ receiptId, backupId, domain: domainRaw, store, snapshotIds = [], now = Date.now(), notes = null } = {}) {
  const gate = evaluateSavingsGate({ store, domain: domainRaw, snapshotIds, now });
  const snapshots = snapshotIds
    .map((snapshotId) => {
      const info = store.info({ domain: domainRaw, snapshotId });
      if (!info) return null;
      return { id: snapshotId, logicalBytes: info.logicalBytes, digest: info.digest, protected: info.protected, retentionUntil: info.retentionUntil };
    })
    .filter(Boolean);
  const receipt = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "DedupReceipt",
    receiptId,
    backupId: backupId ?? null,
    createdAt: new Date(now).toISOString(),
    domain: { tenantId: gate.domain.tenantId, encryptionDomain: gate.domain.encryptionDomain, retentionClass: gate.domain.retentionClass, category: gate.domain.category },
    logicalBytes: gate.measurement.logicalBytes,
    physicalBytes: gate.measurement.physicalBytes,
    savedBytes: gate.measurement.savedBytes,
    physicalToLogicalRatio: Number(gate.measurement.physicalToLogicalRatio.toFixed(6)),
    uniqueChunks: gate.measurement.uniqueChunks,
    references: gate.measurement.references,
    snapshots,
    integrity: { checked: gate.integrity.checked, ok: gate.integrity.ok, corruptions: gate.integrity.corruptions.map((c) => ({ chunkId: c.chunkId, reason: c.reason, snapshots: c.snapshots })) },
    restore: { ok: gate.restore.ok, snapshots: gate.restore.snapshots.map((s) => ({ snapshotId: s.snapshotId, ok: s.ok, bytes: s.bytes })) },
    savingsActive: gate.savingsActive,
    notes,
  };
  return receipt;
}
