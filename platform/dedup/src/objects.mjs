/**
 * DKC-043 — dedup af primære objekter og forretningsposter.
 *
 * Primære objekter kan deduplikeres, men det er **valgfrit** og kræver både en
 * bestået integritetskontrol og en bestået restoretest samt en menneskelig
 * godkendelse. Som standard er det slået fra. Forretningsposter er en
 * eksplicit undtagelse: storage-dedup må aldrig flette dem automatisk — to
 * forretningsdubletter er to selvstændige, versionsstyrede poster indtil en ejer
 * beslutter en sammensmeltning uden for dedup-laget.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./chunker.mjs";
import { normalizeDedupDomain, DedupError } from "./store.mjs";

export class BusinessRecordMergeError extends DedupError {
  constructor(message, code = "business-record-never-merge") {
    super(message, code);
    this.name = "BusinessRecordMergeError";
  }
}

/** Kaster altid for forretningsposter: storage-dedup må ikke flette dem. */
export function assertStorageDedupAllowed(category) {
  if (category === "business-records") {
    throw new BusinessRecordMergeError("storage-dedup må aldrig flette forretningsposter automatisk");
  }
  if (category === "job-events") {
    throw new BusinessRecordMergeError("jobhændelser må ikke indholds-deduplikeres; brug idempotency-nøglen", "events-use-idempotency-key");
  }
  return true;
}

/** Plan for primær dedup ud fra politikken. */
export function planPrimaryObjectDedup(policy) {
  const domain = (policy?.domains ?? []).find((d) => d.category === "primary-objects");
  if (!domain) return { enabled: false, reason: "mangler-i-politikken" };
  if (domain.enabled !== true) return { enabled: false, reason: "slået-fra-som-standard", requiresHumanApproval: true };
  if (domain.requiresValidation !== true || !domain.validation?.integrityTestRef || !domain.validation?.restoreTestRef) {
    return { enabled: false, reason: "mangler-validering" };
  }
  return { enabled: true, reason: "slået-til-med-validering", requiresHumanApproval: Boolean(domain.validation.requiresHumanApproval) };
}

/**
 * Dedup af et primært objekt. Afvises medmindre politikken er slået til,
 * valideringen er bestået, og en navngivet ejer har godkendt den.
 */
export function deduplicatePrimaryObject({ store, policy, domain: domainRaw, objectId, buffer, validation, approvedBy = null } = {}) {
  const plan = planPrimaryObjectDedup(policy);
  if (!plan.enabled) throw new DedupError(`dedup af primære objekter er ikke aktiveret (${plan.reason})`, "primary-dedup-disabled");
  if (validation?.integrityOk !== true || validation?.restoreOk !== true) {
    throw new DedupError("dedup af primære objekter kræver bestået integritets- og restoretest", "primary-dedup-unvalidated");
  }
  if (plan.requiresHumanApproval && (typeof approvedBy !== "string" || approvedBy.trim() === "")) {
    throw new DedupError("dedup af primære objekter kræver en navngivet menneskelig godkendelse", "primary-dedup-needs-approval");
  }
  const domain = normalizeDedupDomain({ ...domainRaw, category: "primary-objects" });
  return store.putSnapshot({ domain, snapshotId: objectId, buffer });
}

/**
 * Gem en forretningspost uden dedup. Hver post får sin egen fil og sit eget
 * referencepunkt, så to identiske dubletter forbliver to poster. Returnerer
 * et referencepunkt — ikke en delt chunk.
 */
export function storeBusinessRecord({ rootDir, tenantId, recordId, buffer } = {}) {
  if (typeof recordId !== "string" || recordId.trim() === "") throw new BusinessRecordMergeError("en forretningspost kræver et recordId");
  if (!rootDir) throw new BusinessRecordMergeError("storeBusinessRecord kræver en rootDir");
  if (!tenantId) throw new BusinessRecordMergeError("storeBusinessRecord kræver en tenantId");
  const relative = join("business-records", String(tenantId), `${recordId}.json`);
  const path = join(rootDir, relative);
  mkdirSync(join(rootDir, "business-records", String(tenantId)), { recursive: true });
  writeFileSync(path, buffer);
  return { stored: true, deduplicated: false, recordId, tenantId, ref: relative, sha256: sha256Hex(buffer), bytes: Buffer.byteLength(buffer) };
}
