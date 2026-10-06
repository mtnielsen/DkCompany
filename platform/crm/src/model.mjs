/**
 * DKC-030 — semantik for CRM med entydigt ejerskab af kundedata.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - en CRM-kilde bruger EspoCRM som system-of-record, en secretreference,
 *     et entydigt ejerskabsfelt og en rolle-/dublethåndteringspolitik,
 *   - hver post bærer en **tenantafgrænset stabil reference**, et entydigt
 *     ejerskab, en dedup-nøgle og et sæt roller der må læse den,
 *   - politikken kræver default-deny, at et salgsteam ikke kan læse en anden
 *     kundes CRM, at dublerede forretningsposter aldrig flettes automatisk, og
 *     at tværgående sletning følger ejerskab og retention også i kopier, og
 *   - en sletterapport er ærlig pr. flade og opgiver resterende kopier.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const SOURCES_PATH = "crm/sources.json";
export const POLICY_PATH = "crm/policy.json";
export const CORPUS_PATH = "crm/corpus/crm.json";
export const REPORT_PATH = "crm/report/crm-report.json";
export const REPORT_DOC_PATH = "docs/crm/crm-report.md";

export const ENTITY_TYPES = ["Account", "Contact", "Opportunity", "Activity"];
export const CLASSIFICATIONS = ["public", "internal", "personal", "special-category", "confidential"];
export const CLASSIFICATION_RANK = { public: 0, internal: 1, personal: 2, "special-category": 3, confidential: 4 };

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadSources(root) {
  return readJson(root, SOURCES_PATH);
}
export function loadPolicy(root) {
  return readJson(root, POLICY_PATH);
}
export function loadCorpus(root) {
  return readJson(root, CORPUS_PATH);
}
export function loadAll(root) {
  return { sources: loadSources(root), policy: loadPolicy(root), corpus: loadCorpus(root) };
}

export function classificationRank(classification) {
  return CLASSIFICATION_RANK[classification] ?? 99;
}

export function principalClearance(principal) {
  return principal?.clearance ?? "internal";
}

/* -------------------------------------------------------------------------- */
/* CRM-kilde                                                                  */
/* -------------------------------------------------------------------------- */

export function crmSourceProblems(data, { supportedTenants = null } = {}) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "crmkildekontrakten er ikke et objekt")];
  if (!isNamedHuman(data.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "crmkilden skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  for (const [i, source] of (data.sources ?? []).entries()) {
    const at = `/sources/${i}`;
    if (ids.has(source.id)) problems.push(err(`${at}/id`, `kilden '${source.id}' er erklæret flere gange`));
    ids.add(source.id);
    if (source.type !== "espocrm") problems.push(err(`${at}/type`, `kilden '${source.id}' skal være EspoCRM`));
    if (source.systemOfRecord !== "upstream") problems.push(err(`${at}/systemOfRecord`, `EspoCRM skal forblive system-of-record`));
    if (source.writeMode !== "adapter-mediated") problems.push(err(`${at}/writeMode`, `skrivning skal gå gennem adapteren`));
    if (!/^(vault|k8s|env|file|kms):/.test(source.secretRef ?? "")) {
      problems.push(err(`${at}/secretRef`, `kilden '${source.id}' skal bruge en secretreference, ikke en rå hemmelighed`));
    }
    if (!(source.ownerField ?? "").trim()) problems.push(err(`${at}/ownerField`, `kilden '${source.id}' skal angive et entydigt ejerskabsfelt`));
    if (!/^[a-z][a-z0-9-]*\|[a-z0-9][a-z0-9._-]{2,}$/.test(source.defaultOwner ?? "")) {
      problems.push(err(`${at}/defaultOwner`, `kilden '${source.id}' skal have en gyldig standardejer`));
    }
    if (!(source.entityTypes ?? []).length) problems.push(err(`${at}/entityTypes`, `kilden '${source.id}' skal angive mindst én entitetstype`));
    for (const entityType of source.entityTypes ?? []) {
      if (!ENTITY_TYPES.includes(entityType)) problems.push(err(`${at}/entityTypes`, `den ukendte entitetstype '${entityType}'`));
      if (!(source.dedupKeys?.[entityType] ?? []).length) problems.push(err(`${at}/dedupKeys/${entityType}`, `entitetstypen '${entityType}' mangler dedup-nøgler`));
    }
    if (!Object.keys(source.roles ?? {}).length) problems.push(err(`${at}/roles`, `kilden '${source.id}' skal erklære mindst én rolle`));
    for (const [role, def] of Object.entries(source.roles ?? {})) {
      if (!Array.isArray(def.entityTypes) || def.entityTypes.length === 0) {
        problems.push(err(`${at}/roles/${role}/entityTypes`, `rollen '${role}' skal angive hvilke entitetstyper den må læse`));
      }
      for (const entityType of def.entityTypes ?? []) {
        if (!(source.entityTypes ?? []).includes(entityType)) {
          problems.push(err(`${at}/roles/${role}/entityTypes`, `rollen '${role}' peger på den ikke-erklærede entitetstype '${entityType}'`));
        }
      }
    }
    if (source.tenantId && supportedTenants && !supportedTenants.has(source.tenantId)) {
      problems.push(err(`${at}/tenantId`, `kilden '${source.id}' peger på den ukendte tenant '${source.tenantId}'`));
    }
    const retention = source.retention ?? {};
    for (const key of ["contactDays", "activityDays", "copyDays"]) {
      if (!(retention[key] >= 1)) problems.push(err(`${at}/retention/${key}`, `retentionen '${key}' skal være positiv`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* CRM-politik                                                                */
/* -------------------------------------------------------------------------- */

export function crmPolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "crmpolitikken er ikke et objekt")];
  if (!isNamedHuman(policy.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "crmpolitikken skal have et navngivet menneske som ejer"));
  }
  const auth = policy.authorization ?? {};
  if (auth.defaultDeny !== true) problems.push(err("/authorization/defaultDeny", "adgang skal være default-deny"));
  if (auth.tenantIsolation !== true) problems.push(err("/authorization/tenantIsolation", "tenants skal være isoleret"));
  if (auth.salesCannotReadOtherCustomer !== true) problems.push(err("/authorization/salesCannotReadOtherCustomer", "et salgsteam må ikke kunne læse en anden kundes CRM"));
  if (auth.roleProtection !== true) problems.push(err("/authorization/roleProtection", "roller skal beskyttes"));
  if (auth.ownerRequired !== true) problems.push(err("/authorization/ownerRequired", "hver post skal have et ejerskab"));
  if (auth.revalidateAtRead !== true) problems.push(err("/authorization/revalidateAtRead", "adgang skal revalideres ved læsning"));

  const refs = policy.references ?? {};
  if (refs.scheme !== "platform-tenant-scoped") problems.push(err("/references/scheme", "referencen skal være tenantafgrænset"));
  if (refs.systemOfRecord !== "upstream") problems.push(err("/references/systemOfRecord", "system-of-record skal være upstream"));
  if (refs.stableReference !== true) problems.push(err("/references/stableReference", "referencen skal være stabil"));
  if (refs.crossTenantReference !== "denied") problems.push(err("/references/crossTenantReference", "en tværtenant-reference skal afvises"));

  const dedup = policy.dedup ?? {};
  if (dedup.retryIdempotent !== true) problems.push(err("/dedup/retryIdempotent", "et retry skal være idempotent"));
  if (dedup.idempotencyKeyRequired !== true) problems.push(err("/dedup/idempotencyKeyRequired", "import skal kræve en idempotency-nøgle"));
  if (dedup.dedupKeysRequired !== true) problems.push(err("/dedup/dedupKeysRequired", "dublethåndtering skal kræve dedup-nøgler"));
  if (dedup.businessRecordsNeverMerged !== true) problems.push(err("/dedup/businessRecordsNeverMerged", "dublerede forretningsposter må aldrig flettes automatisk"));
  if (dedup.crossTenantDedup !== false) problems.push(err("/dedup/crossTenantDedup", "dedup på tværs af tenants er forbudt"));
  if (dedup.conflictRequiresHuman !== true) problems.push(err("/dedup/conflictRequiresHuman", "en dubletkonflikt skal kræve et menneske"));

  const activities = policy.activities ?? {};
  if (activities.appendOnly !== true) problems.push(err("/activities/appendOnly", "aktiviteter skal være append-only"));
  if (activities.immutable !== true) problems.push(err("/activities/immutable", "aktiviteter skal være uforanderlige"));
  if (activities.recordsEveryTransition !== true) problems.push(err("/activities/recordsEveryTransition", "hver tilstandsovergang skal registreres"));

  const retention = policy.retention ?? {};
  for (const key of ["contactDays", "activityDays"]) {
    if (!(retention[key] >= 1)) problems.push(err(`/retention/${key}`, `retentionen '${key}' skal være positiv`));
  }
  if (retention.copiesMustFollowDeletion !== true) problems.push(err("/retention/copiesMustFollowDeletion", "kopier skal følge sletningen"));
  if (retention.legalHoldBlocksDeletion !== true) problems.push(err("/retention/legalHoldBlocksDeletion", "et legal hold skal blokere sletning"));
  if (retention.deletionIsTombstone !== true) problems.push(err("/retention/deletionIsTombstone", "sletning skal efterlade en tombstone"));

  const exported = policy.export ?? {};
  if (exported.format !== "json") problems.push(err("/export/format", "eksportformatet skal være json"));
  if (exported.stableReferences !== true) problems.push(err("/export/stableReferences", "eksporten skal bevare stabile referencer"));
  if (exported.includeActivities !== true) problems.push(err("/export/includeActivities", "eksporten skal inkludere aktiviteter"));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* CRM-post                                                                   */
/* -------------------------------------------------------------------------- */

const REFERENCE_RE = /^crm:([a-z0-9][a-z0-9-]{1,62}):([A-Za-z]+):([A-Za-z0-9._-]+)$/;

export function crmRecordProblems(record) {
  const problems = [];
  if (!record || typeof record !== "object") return [err("/", "posten er ikke et objekt")];
  const match = REFERENCE_RE.exec(record.reference ?? "");
  if (!match) {
    problems.push(err("/reference", `referencen '${record.reference}' er ikke en tenantafgrænset crm-reference`));
  } else {
    const [, tenantId, entityType, upstreamId] = match;
    if (record.tenantId !== tenantId) problems.push(err("/tenantId", `referencen peger på tenanten '${tenantId}', men posten har '${record.tenantId}'`));
    if (record.entityType !== entityType) problems.push(err("/entityType", `referencen peger på entitetstypen '${entityType}'`));
    if (String(record.upstreamId) !== upstreamId) problems.push(err("/upstreamId", `referencen peger på upstream-id'et '${upstreamId}'`));
  }
  if (record.id !== record.reference) problems.push(err("/id", "postens id skal være den stabile reference"));
  if (!ENTITY_TYPES.includes(record.entityType)) problems.push(err("/entityType", `den ukendte entitetstype '${record.entityType}'`));
  if (!CLASSIFICATIONS.includes(record.classification)) problems.push(err("/classification", `posten '${record.reference}' mangler en gyldig klassifikation`));
  if (!record.owner?.subject) problems.push(err("/owner/subject", `posten '${record.reference}' mangler et entydigt ejerskab`));
  if (record.owner && record.owner.tenantId !== record.tenantId) problems.push(err("/owner/tenantId", "ejerskabet skal være i samme tenant som posten"));
  if (!/^[a-f0-9]{64}$/.test(record.dedupKey ?? "")) problems.push(err("/dedupKey", `posten '${record.reference}' mangler en gyldig dedup-nøgle`));
  if (!(record.roles ?? []).length) problems.push(err("/roles", `posten '${record.reference}' skal angive hvilke roller der må læse den`));
  if (!(record.version >= 1)) problems.push(err("/version", `posten '${record.reference}' skal have en positiv version`));
  for (const [i, copy] of (record.copies ?? []).entries()) {
    if (!copy.surface || !copy.ref) problems.push(err(`/copies/${i}`, "en kopi skal angive flade og reference"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Sletterapport                                                              */
/* -------------------------------------------------------------------------- */

export const DELETION_SURFACES = ["primary", "activities", "index", "copies", "backup"];

export function crmDeletionReceiptProblems(receipt) {
  const problems = [];
  if (!receipt || typeof receipt !== "object") return [err("/", "sletterapporten er ikke et objekt")];
  if (!["full", "partial", "blocked"].includes(receipt.status)) problems.push(err("/status", "sletterapporten har en ukendt status"));
  if (!receipt.accountReference?.startsWith("crm:")) problems.push(err("/accountReference", "sletterapporten skal pege på en crm-reference"));
  for (const surface of DELETION_SURFACES) {
    const s = receipt.surfaces?.[surface];
    if (!s) problems.push(err(`/surfaces/${surface}`, `fladen '${surface}' mangler`));
    else if (!["full", "partial", "unsupported", "blocked"].includes(s.status)) problems.push(err(`/surfaces/${surface}/status`, `fladen '${surface}' har en ukendt status`));
  }
  if (receipt.status === "full" && (receipt.remainingCopies ?? []).length > 0) {
    problems.push(err("/remainingCopies", "en fuld sletning må ikke have resterende kopier"));
  }
  if (receipt.status === "partial" && (receipt.remainingCopies ?? []).length === 0) {
    problems.push(err("/remainingCopies", "en delvis sletning skal opgive de resterende kopier"));
  }
  if ((receipt.status === "blocked") && !receipt.legalHoldId) {
    problems.push(err("/legalHoldId", "en blokeret sletning skal pege på det blokerende legal hold"));
  }
  return problems;
}
