/**
 * DKC-043 — kanonisk dedup-politik og dens beslutningssemantik.
 *
 * Politikken beskriver fire separate dedup-domæner. Den maskinlæsbare form
 * håndhæves af `contracts/dedup-policy.schema.json`; denne modul håndhæver de
 * beslutninger som skemaet ikke kan udtrykke:
 *
 *   - der deduplikeres aldrig på tværs af kunder,
 *   - backupblokke er det primære, gennemprøvede design; dedup af primære
 *     objekter er valgfrit og kræver sin egen validering,
 *   - jobhændelser deduplikeres kun på en eksplicit idempotency-nøgle, aldrig
 *     på indhold,
 *   - forretningsposter flettes aldrig automatisk.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DEDUP_POLICY_PATH = "dedup/dedup-policy.json";
export const DEDUP_CATEGORIES = Object.freeze(["backup-blocks", "primary-objects", "job-events", "business-records"]);

export function loadDedupPolicy(root) {
  if (!root) throw new Error("loadDedupPolicy kræver en repo-rod");
  return JSON.parse(readFileSync(join(root, DEDUP_POLICY_PATH), "utf8"));
}

function err(path, message) {
  return { path, message };
}

/** Beslutningssemantik ud over skemaet. Returnerer en liste af problemer. */
export function dedupPolicyProblems(policy) {
  const problems = [];
  if (!policy) return [err("/", "dedup-politikken mangler")];

  if (policy.crossTenantDedup !== false) {
    problems.push(err("/crossTenantDedup", "dedup på tværs af kunder er forbudt som standard"));
  }
  if (policy.primaryDataDedupOptional !== true) {
    problems.push(err("/primaryDataDedupOptional", "dedup af primærdata skal være valgfrit"));
  }

  const domains = policy.domains ?? [];
  const byCategory = new Map();
  for (const [index, domain] of domains.entries()) {
    if (byCategory.has(domain.category)) problems.push(err(`/domains/${index}/category`, `dubleret kategori '${domain.category}'`));
    byCategory.set(domain.category, domain);
    const boundary = domain.boundary ?? {};
    if (boundary.tenantScoped !== true) problems.push(err(`/domains/${index}/boundary/tenantScoped`, "dedupgrænsen skal være tenant-afgrænset"));
    if (boundary.encryptionDomainScoped !== true) problems.push(err(`/domains/${index}/boundary/encryptionDomainScoped`, "dedupgrænsen skal være krypteringsdomæne-afgrænset"));
    if (boundary.retentionClassScoped !== true) problems.push(err(`/domains/${index}/boundary/retentionClassScoped`, "dedupgrænsen skal være retentionklasse-afgrænset"));
    if (boundary.crossTenantDedup !== false) problems.push(err(`/domains/${index}/boundary/crossTenantDedup`, "ingen tværkundededuplikering som standard"));
  }

  for (const category of DEDUP_CATEGORIES) {
    if (!byCategory.has(category)) problems.push(err("/domains", `dedup-politikken mangler kategorien '${category}'`));
  }

  // 1) Backupblokke: gennemprøvet backupløsning, slået til og med referencekæde.
  const backup = byCategory.get("backup-blocks");
  if (backup) {
    if (backup.enabled !== true) problems.push(err("/domains/backup-blocks/enabled", "dedup af backupblokke skal være slået til"));
    if (backup.mergeSemantics !== "content-addressed-chunks") problems.push(err("/domains/backup-blocks/mergeSemantics", "backupblokke skal deduplikeres som indholdsadresserede chunks"));
    if (!backup.providerRef) problems.push(err("/domains/backup-blocks/providerRef", "backupblokke skal bygge på en gennemprøvet backupløsning"));
  }

  // 2) Primære objekter: valgfrit og kun med egen validering.
  const primary = byCategory.get("primary-objects");
  if (primary) {
    if (primary.enabled === true) {
      if (primary.requiresValidation !== true) problems.push(err("/domains/primary-objects/requiresValidation", "dedup af primære objekter kræver egen validering"));
      if (!primary.validation?.integrityTestRef || !primary.validation?.restoreTestRef) {
        problems.push(err("/domains/primary-objects/validation", "dedup af primære objekter kræver både integritets- og restoretest"));
      }
    }
  }

  // 3) Jobhændelser: kun idempotency-nøgle, aldrig indholdsfletning.
  const events = byCategory.get("job-events");
  if (events) {
    if (events.mergeSemantics !== "idempotency-key-only") problems.push(err("/domains/job-events/mergeSemantics", "jobhændelser må kun deduplikeres på en idempotency-nøgle"));
    if (!Array.isArray(events.dedupKey) || events.dedupKey.length === 0) problems.push(err("/domains/job-events/dedupKey", "jobhændelser kræver en eksplicit dedup-nøgle"));
  }

  // 4) Forretningsposter: aldrig automatisk sammensmeltning.
  const business = byCategory.get("business-records");
  if (business) {
    if (business.mergeSemantics !== "never-merge") problems.push(err("/domains/business-records/mergeSemantics", "forretningsposter må aldrig flettes automatisk af storage-dedup"));
    if (business.enabled !== false) problems.push(err("/domains/business-records/enabled", "forretningsposter må ikke deduplikeres automatisk"));
  }

  // Garbage collection og besparelsesgate.
  const gc = policy.garbageCollection ?? {};
  if (gc.retentionAware !== true) problems.push(err("/garbageCollection/retentionAware", "garbage collection skal være retention-aware"));
  if (gc.singleWriterLease !== true) problems.push(err("/garbageCollection/singleWriterLease", "prune skal kræve en single-writer lease"));
  if (gc.markAndSweep !== true) problems.push(err("/garbageCollection/markAndSweep", "prune skal være mark-and-sweep"));
  if (gc.leaseRequiredForPrune !== true) problems.push(err("/garbageCollection/leaseRequiredForPrune", "prune må ikke kunne køre uden en lease"));

  const gate = policy.savingsGate ?? {};
  if (gate.requireIntegrityCheck !== true) problems.push(err("/savingsGate/requireIntegrityCheck", "besparelser må kun aktiveres efter en integritetskontrol"));
  if (gate.requireFullRestore !== true) problems.push(err("/savingsGate/requireFullRestore", "besparelser må kun aktiveres efter en fuld restore"));
  if (gate.activateOnlyWhenBothPass !== true) problems.push(err("/savingsGate/activateOnlyWhenBothPass", "besparelser må kun aktiveres når både integritet og restore består"));

  const keys = policy.keys ?? {};
  if (keys.storeContainsKey !== false) problems.push(err("/keys/storeContainsKey", "dedup-lageret må ikke indeholde nøglen"));
  if (keys.domainScoped !== true) problems.push(err("/keys/domainScoped", "dedup-nøgler skal være domæneafgrænsede"));

  return problems;
}

/** Bekræft at de refererede providerfiler faktisk findes i checkouten. */
export function dedupProviderProblems(policy, repoRoot) {
  const problems = [];
  for (const domain of policy.domains ?? []) {
    if (domain.providerRef && !existsSync(join(repoRoot, domain.providerRef))) {
      problems.push(err(`/domains/${domain.category}/providerRef`, `providerfilen '${domain.providerRef}' findes ikke`));
    }
  }
  if (policy.provenBackupSolutionRef && !existsSync(join(repoRoot, policy.provenBackupSolutionRef))) {
    problems.push(err("/provenBackupSolutionRef", `den gennemprøvede backupløsning '${policy.provenBackupSolutionRef}' findes ikke`));
  }
  return problems;
}
