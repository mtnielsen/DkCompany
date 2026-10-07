/**
 * DKC-031 — semantik for migrations- og exitværktøjer.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - hver pilotapp har ét valgt, dokumenteret kildeformat der kan læses uden
 *     en aktiv DkCompany-installation,
 *   - en kilde erklærer alle seks dækningsfacetter (ejerskab, timestamps,
 *     kommentarer, bilag, ACL og links) pr. entitetstype, og en facet der ikke
 *     er fuldt understøttet skal have en forklaring, så tabt funktionalitet
 *     vises før cutover,
 *   - politikken kræver dry-run, resumable og idempotent import, at dublerede
 *     forretningsposter aldrig flettes automatisk, og at cutover kræver en
 *     afstemt dry-run, en dokumenteret rollback og en menneskelig
 *     pilotgodkendelse af både indhold og adgangsrettigheder,
 *   - en afstemning opgiver antal og checksums og er ærlig om et mismatch,
 *   - en eksport er selvbeskrivende, indeholder alle facetter og kan læses uden
 *     platformen, og
 *   - en godkendelse kommer fra et navngivet menneske i kundens tenant, ikke
 *     fra den der udførte migrationen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const SOURCES_PATH = "migration/sources.json";
export const POLICY_PATH = "migration/policy.json";
export const CORPUS_PATH = "migration/corpus/migration.json";
export const REPORT_PATH = "migration/report/migration-report.json";
export const REPORT_DOC_PATH = "docs/migration/migration-report.md";
export const EXPORT_DOC_PATH = "docs/migration/exit-export.md";

/** De pilotapps migrationen understøtter, med det valgte upstream-produkt. */
export const PILOT_APPS = ["files", "projects", "knowledge", "support", "crm"];
export const PILOT_PRODUCTS = {
  files: "nextcloud",
  projects: "openproject",
  knowledge: "bookstack",
  support: "zammad",
  crm: "espocrm",
};

/** De seks dækningsfacetter en coverage-matrix altid skal dække. */
export const COVERAGE_FACETS = ["ownership", "timestamps", "comments", "attachments", "acl", "links"];
export const FACET_STATUSES = ["full", "partial", "unsupported"];

/** Entitetstyper pr. pilotapp, som kilderne må erklære. */
export const ENTITY_TYPES = {
  files: ["File", "Folder"],
  projects: ["Project", "WorkPackage"],
  knowledge: ["Page"],
  support: ["Ticket"],
  crm: ["Contact"],
};

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

/* -------------------------------------------------------------------------- */
/* Migrationskilde                                                            */
/* -------------------------------------------------------------------------- */

export function migrationSourceProblems(data, { supportedTenants = null, requireAllPilotApps = true } = {}) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "migrationskildekontrakten er ikke et objekt")];
  if (!isNamedHuman(data.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "migrationskilderne skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  const perApp = new Set();
  for (const [i, source] of (data.sources ?? []).entries()) {
    const at = `/sources/${i}`;
    if (ids.has(source.id)) problems.push(err(`${at}/id`, `kilden '${source.id}' er erklæret flere gange`));
    ids.add(source.id);
    if (!PILOT_APPS.includes(source.appId)) {
      problems.push(err(`${at}/appId`, `den ukendte pilotapp '${source.appId}'`));
      continue;
    }
    if (perApp.has(`${source.tenantId}:${source.appId}`)) {
      problems.push(err(`${at}/appId`, `pilotappen '${source.appId}' har mere end ét kildeformat for tenanten '${source.tenantId}'`));
    }
    perApp.add(`${source.tenantId}:${source.appId}`);
    if (source.product !== PILOT_PRODUCTS[source.appId]) {
      problems.push(err(`${at}/product`, `pilotappen '${source.appId}' skal bruge '${PILOT_PRODUCTS[source.appId]}'`));
    }
    if (source.systemOfRecord !== "upstream") problems.push(err(`${at}/systemOfRecord`, "kilden skal forblive system-of-record under migration"));
    if (source.tenantId && supportedTenants && !supportedTenants.has(source.tenantId)) {
      problems.push(err(`${at}/tenantId`, `kilden '${source.id}' peger på den ukendte tenant '${source.tenantId}'`));
    }

    const format = source.format ?? {};
    if (!(format.id ?? "").trim()) problems.push(err(`${at}/format/id`, `kilden '${source.id}' skal angive ét valgt kildeformat`));
    if (!(format.version ?? "").trim()) problems.push(err(`${at}/format/version`, `formatet for '${source.id}' skal have en version`));
    if (!(format.mediaType ?? "").trim()) problems.push(err(`${at}/format/mediaType`, `formatet for '${source.id}' skal have en medietype`));
    if (format.documented !== true) problems.push(err(`${at}/format/documented`, `formatet for '${source.id}' skal være dokumenteret`));
    if (!(format.docsRef ?? "").trim()) problems.push(err(`${at}/format/docsRef`, `formatet for '${source.id}' skal pege på dokumentation`));
    if (format.readableWithoutPlatform !== true) {
      problems.push(err(`${at}/format/readableWithoutPlatform`, `formatet for '${source.id}' skal kunne læses uden en aktiv DkCompany-installation`));
    }

    const entityTypes = source.entityTypes ?? [];
    if (entityTypes.length === 0) problems.push(err(`${at}/entityTypes`, `kilden '${source.id}' skal angive mindst én entitetstype`));
    for (const entityType of entityTypes) {
      if (!(ENTITY_TYPES[source.appId] ?? []).includes(entityType)) {
        problems.push(err(`${at}/entityTypes`, `den ukendte entitetstype '${entityType}' for '${source.appId}'`));
        continue;
      }
      const dedupKeys = source.dedupKeys?.[entityType];
      if (!Array.isArray(dedupKeys) || dedupKeys.length === 0) {
        problems.push(err(`${at}/dedupKeys/${entityType}`, `entitetstypen '${entityType}' mangler dedup-nøgler`));
      }
      const facets = source.facets?.[entityType];
      if (!facets) {
        problems.push(err(`${at}/facets/${entityType}`, `entitetstypen '${entityType}' mangler en dækningsmatrix`));
        continue;
      }
      for (const facet of COVERAGE_FACETS) {
        const entry = facets[facet];
        if (!entry) {
          problems.push(err(`${at}/facets/${entityType}/${facet}`, `dækningsfacetten '${facet}' mangler`));
          continue;
        }
        if (!FACET_STATUSES.includes(entry.status)) {
          problems.push(err(`${at}/facets/${entityType}/${facet}/status`, `facetten '${facet}' har en ukendt status`));
        }
        if (entry.status !== "full" && !(entry.note ?? "").trim()) {
          problems.push(err(`${at}/facets/${entityType}/${facet}/note`, `facetten '${facet}' er '${entry.status}' og skal have en forklaring`));
        }
        if (entry.status === "full" && !(entry.source ?? "").trim()) {
          problems.push(err(`${at}/facets/${entityType}/${facet}/source`, `facetten '${facet}' er fuldt understøttet og skal angive sit kildefelt`));
        }
      }
      for (const facet of Object.keys(facets)) {
        if (!COVERAGE_FACETS.includes(facet)) problems.push(err(`${at}/facets/${entityType}/${facet}`, `den ukendte dækningsfacette '${facet}'`));
      }
    }

    if (!Object.keys(source.roles ?? {}).length) problems.push(err(`${at}/roles`, `kilden '${source.id}' skal erklære mindst én rolle`));
    for (const [role, def] of Object.entries(source.roles ?? {})) {
      if (!Array.isArray(def.appIds) || !def.appIds.includes(source.appId)) {
        problems.push(err(`${at}/roles/${role}/appIds`, `rollen '${role}' skal dække '${source.appId}'`));
      }
    }
    if (!/^[a-z][a-z0-9-]*\|[a-z0-9][a-z0-9._-]{2,}$/.test(source.defaultOwner ?? "")) {
      problems.push(err(`${at}/defaultOwner`, `kilden '${source.id}' skal have en gyldig standardejer`));
    }
    for (const key of ["recordDays", "exportDays"]) {
      if (!(source.retention?.[key] >= 1)) problems.push(err(`${at}/retention/${key}`, `retentionen '${key}' skal være positiv`));
    }
  }
  if (requireAllPilotApps && perApp.size && ![...PILOT_APPS].every((app) => [...perApp].some((entry) => entry.endsWith(`:${app}`)))) {
    for (const app of PILOT_APPS) {
      if (![...perApp].some((entry) => entry.endsWith(`:${app}`))) problems.push(err("/sources", `pilotappen '${app}' mangler et valgt kildeformat`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Migrationspolitik                                                          */
/* -------------------------------------------------------------------------- */

export function migrationPolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "migrationspolitikken er ikke et objekt")];
  if (!isNamedHuman(policy.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "migrationspolitikken skal have et navngivet menneske som ejer"));
  }
  const auth = policy.authorization ?? {};
  if (auth.defaultDeny !== true) problems.push(err("/authorization/defaultDeny", "adgang skal være default-deny"));
  if (auth.tenantIsolation !== true) problems.push(err("/authorization/tenantIsolation", "tenants skal være isoleret"));
  if (auth.roleProtection !== true) problems.push(err("/authorization/roleProtection", "roller skal beskyttes"));
  if (auth.revalidateAtRead !== true) problems.push(err("/authorization/revalidateAtRead", "adgang skal revalideres ved læsning"));
  if (auth.crossTenantImport !== false) problems.push(err("/authorization/crossTenantImport", "import på tværs af tenants er forbudt"));

  const imp = policy.import ?? {};
  if (imp.dryRunRequired !== true) problems.push(err("/import/dryRunRequired", "en dry-run skal være påkrævet før import"));
  if (imp.resumable !== true) problems.push(err("/import/resumable", "importen skal kunne genoptages"));
  if (imp.checkpointRequired !== true) problems.push(err("/import/checkpointRequired", "importen skal gemme et checkpoint"));
  if (imp.idempotencyKeyRequired !== true) problems.push(err("/import/idempotencyKeyRequired", "importen skal kræve en idempotency-nøgle"));
  if (imp.dedupKeysRequired !== true) problems.push(err("/import/dedupKeysRequired", "importen skal kræve dedup-nøgler"));
  if (imp.errorListRequired !== true) problems.push(err("/import/errorListRequired", "importen skal føre en fejlliste"));
  if (imp.businessRecordsNeverMerged !== true) problems.push(err("/import/businessRecordsNeverMerged", "dublerede forretningsposter må aldrig flettes automatisk"));
  if (imp.crossTenantDedup !== false) problems.push(err("/import/crossTenantDedup", "dedup på tværs af tenants er forbudt"));
  if (imp.conflictRequiresHuman !== true) problems.push(err("/import/conflictRequiresHuman", "en dubletkonflikt skal kræve et menneske"));
  if (imp.repeatedImportCreatesDuplicates !== false) problems.push(err("/import/repeatedImportCreatesDuplicates", "en gentaget import må ikke skabe dubletter"));

  const cov = policy.coverage ?? {};
  if (cov.requireAllFacetsDeclared !== true) problems.push(err("/coverage/requireAllFacetsDeclared", "alle dækningsfacetter skal erklæres"));
  if (cov.unsupportedRequiresNote !== true) problems.push(err("/coverage/unsupportedRequiresNote", "en ikke-understøttet facet skal have en forklaring"));
  if (cov.showLostFunctionalityBeforeCutover !== true) problems.push(err("/coverage/showLostFunctionalityBeforeCutover", "tabt funktionalitet skal vises før cutover"));
  for (const facet of COVERAGE_FACETS) {
    if (!(cov.facets ?? []).includes(facet)) problems.push(err("/coverage/facets", `dækningsfacetten '${facet}' mangler i politikken`));
  }

  const rec = policy.reconciliation ?? {};
  if (rec.algorithm !== "sha256") problems.push(err("/reconciliation/algorithm", "afstemningen skal bruge sha256"));
  if (rec.requireCountsMatch !== true) problems.push(err("/reconciliation/requireCountsMatch", "antal skal afstemmes"));
  if (rec.requireChecksumsMatch !== true) problems.push(err("/reconciliation/requireChecksumsMatch", "checksums skal afstemmes"));

  const exp = policy.export ?? {};
  if (!(exp.formats ?? []).length) problems.push(err("/export/formats", "eksporten skal angive mindst ét dokumenteret format"));
  if (exp.selfDescribing !== true) problems.push(err("/export/selfDescribing", "eksporten skal være selvbeskrivende"));
  if (exp.readableWithoutPlatform !== true) problems.push(err("/export/readableWithoutPlatform", "eksporten skal kunne læses uden platformen"));
  if (exp.includeFacets !== true) problems.push(err("/export/includeFacets", "eksporten skal inkludere alle facetter"));
  if (exp.includeAcl !== true) problems.push(err("/export/includeAcl", "eksporten skal inkludere ACL"));

  const cut = policy.cutover ?? {};
  if (cut.requiresReconciliation !== true) problems.push(err("/cutover/requiresReconciliation", "cutover skal kræve en afstemt dry-run"));
  if (cut.requiresPilotApproval !== true) problems.push(err("/cutover/requiresPilotApproval", "cutover skal kræve en pilotgodkendelse"));
  if (cut.requiresRollback !== true) problems.push(err("/cutover/requiresRollback", "cutover skal kræve en dokumenteret rollback"));
  if (cut.approvalMustBeHuman !== true) problems.push(err("/cutover/approvalMustBeHuman", "godkendelsen skal komme fra et menneske"));
  if (cut.twoPerson !== true) problems.push(err("/cutover/twoPerson", "cutover skal kræve to-personers-kontrol"));
  if (cut.rollbackRestoresRights !== true) problems.push(err("/cutover/rollbackRestoresRights", "rollback skal gendanne rettigheder"));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Dækningsmatrix                                                             */
/* -------------------------------------------------------------------------- */

export function migrationCoverageProblems(coverage, { sources = [] } = {}) {
  const problems = [];
  if (!coverage || typeof coverage !== "object") return [err("/", "dækningsmatricen er ikke et objekt")];
  const matrix = coverage.matrix ?? [];
  if (!matrix.length) problems.push(err("/matrix", "dækningsmatricen er tom"));
  const declared = new Map();
  for (const source of sources) {
    for (const entityType of source.entityTypes ?? []) declared.set(`${source.tenantId}:${source.appId}:${entityType}`, source.facets?.[entityType] ?? {});
  }
  const seen = new Set();
  for (const [i, row] of matrix.entries()) {
    const at = `/matrix/${i}`;
    if (!COVERAGE_FACETS.includes(row.facet)) problems.push(err(`${at}/facet`, `den ukendte facette '${row.facet}'`));
    if (!FACET_STATUSES.includes(row.status)) problems.push(err(`${at}/status`, `den ukendte status '${row.status}'`));
    const key = `${row.tenantId}:${row.appId}:${row.entityType}:${row.facet}`;
    if (seen.has(key)) problems.push(err(at, `dubleret matrixrække '${key}'`));
    seen.add(key);
    if (declared.size) {
      const facet = declared.get(`${row.tenantId}:${row.appId}:${row.entityType}`)?.[row.facet];
      if (facet && facet.status !== row.status) {
        problems.push(err(`${at}/status`, `matricen siger '${row.status}', men kilden erklærer '${facet.status}'`));
      }
    }
    if (row.status !== "full" && !(row.note ?? "").trim()) problems.push(err(`${at}/note`, `facetten '${row.facet}' er '${row.status}' og skal have en forklaring`));
  }
  if (declared.size) {
    for (const [key, facets] of declared) {
      for (const facet of COVERAGE_FACETS) {
        if (!seen.has(`${key}:${facet}`)) problems.push(err("/matrix", `dækningsmatricen mangler '${key}:${facet}'`));
      }
    }
  }
  const lost = coverage.lostFunctionality ?? [];
  const expectedLost = matrix.filter((r) => r.status !== "full").map((r) => `${r.tenantId}:${r.appId}:${r.entityType}:${r.facet}`);
  for (const entry of lost) {
    if (!entry.appId || !entry.entityType || !entry.facet) problems.push(err("/lostFunctionality", "en tabt funktionalitet skal angive app, entitetstype og facet"));
  }
  const lostKeys = new Set(lost.map((entry) => `${entry.tenantId}:${entry.appId}:${entry.entityType}:${entry.facet}`));
  for (const key of expectedLost) {
    if (!lostKeys.has(key)) problems.push(err("/lostFunctionality", `tabt funktionalitet '${key}' mangler`));
  }
  for (const key of lostKeys) {
    if (!expectedLost.includes(key)) problems.push(err("/lostFunctionality", `'${key}' er ikke en ikke-fuld facet`));
  }
  const summary = coverage.summary ?? {};
  const counts = { full: 0, partial: 0, unsupported: 0 };
  for (const row of matrix) counts[row.status] = (counts[row.status] ?? 0) + 1;
  for (const key of Object.keys(counts)) {
    if (summary[key] !== counts[key]) problems.push(err("/summary", `summary.${key} er '${summary[key]}', men matricen har ${counts[key]}`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Afstemning (dry-run / import)                                              */
/* -------------------------------------------------------------------------- */

export function migrationReconciliationProblems(reconciliation) {
  const problems = [];
  if (!reconciliation || typeof reconciliation !== "object") return [err("/", "afstemningen er ikke et objekt")];
  if (!["dry-run", "import"].includes(reconciliation.mode)) problems.push(err("/mode", "afstemningen skal være 'dry-run' eller 'import'"));
  const counts = reconciliation.counts ?? {};
  if (!(counts.source >= 0)) problems.push(err("/counts/source", "kildeantallet skal være ikke-negativt"));
  if (!(counts.created >= 0) || !(counts.updated >= 0) || !(counts.conflicts >= 0) || !(counts.skipped >= 0) || !(counts.failed >= 0)) {
    problems.push(err("/counts", "alle tællere skal være ikke-negative"));
  }
  const classified = (counts.created ?? 0) + (counts.updated ?? 0) + (counts.conflicts ?? 0) + (counts.skipped ?? 0) + (counts.failed ?? 0);
  if (reconciliation.mode === "dry-run" && classified !== counts.source) {
    problems.push(err("/counts", `klassificeringen (${classified}) afstemmer ikke med kildeantallet (${counts.source})`));
  }
  const checksums = reconciliation.checksums ?? {};
  if (checksums.algorithm !== "sha256") problems.push(err("/checksums/algorithm", "checksum-algoritmen skal være sha256"));
  if (!/^[a-f0-9]{64}$/.test(checksums.source ?? "")) problems.push(err("/checksums/source", "kildens checksum skal være en sha256"));
  if (!/^[a-f0-9]{64}$/.test(checksums.target ?? "")) problems.push(err("/checksums/target", "målets checksum skal være en sha256"));
  if (checksums.match !== (checksums.source === checksums.target)) {
    problems.push(err("/checksums/match", "'match' stemmer ikke med de to checksums"));
  }
  const errors = reconciliation.errors ?? [];
  for (const [i, entry] of errors.entries()) {
    if (!entry.sourceObjectId || !entry.code || !entry.message) problems.push(err(`/errors/${i}`, "en fejl skal angive objekt, kode og besked"));
  }
  if ((reconciliation.coverageLosses ?? []).length && reconciliation.mode === "dry-run" && !reconciliation.coverageLosses.every((l) => l.facet)) {
    problems.push(err("/coverageLosses", "en dækningsgevinst skal angive en facet"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Migrationspost                                                             */
/* -------------------------------------------------------------------------- */

const MIGRATION_REFERENCE_RE = /^mig:([a-z0-9][a-z0-9-]{1,62}):([a-z]+):([A-Za-z]+):([A-Za-z0-9._-]+)$/;

export function migrationRecordProblems(record) {
  const problems = [];
  if (!record || typeof record !== "object") return [err("/", "posten er ikke et objekt")];
  const match = MIGRATION_REFERENCE_RE.exec(record.reference ?? "");
  if (!match) {
    problems.push(err("/reference", `referencen '${record.reference}' er ikke en tenantafgrænset migrationsreference`));
  } else {
    const [, tenantId, appId, entityType, sourceObjectId] = match;
    if (record.tenantId !== tenantId) problems.push(err("/tenantId", `referencen peger på tenanten '${tenantId}'`));
    if (record.appId !== appId) problems.push(err("/appId", `referencen peger på appen '${appId}'`));
    if (record.entityType !== entityType) problems.push(err("/entityType", `referencen peger på entitetstypen '${entityType}'`));
    if (String(record.sourceObjectId) !== sourceObjectId) problems.push(err("/sourceObjectId", `referencen peger på kildeobjektet '${sourceObjectId}'`));
  }
  if (record.id !== record.reference) problems.push(err("/id", "postens id skal være den stabile reference"));
  if (!PILOT_APPS.includes(record.appId)) problems.push(err("/appId", `den ukendte pilotapp '${record.appId}'`));
  if (!CLASSIFICATIONS.includes(record.classification)) problems.push(err("/classification", `posten '${record.reference}' mangler en gyldig klassifikation`));
  if (!record.owner?.subject) problems.push(err("/owner/subject", `posten '${record.reference}' mangler et ejerskab`));
  if (record.owner && record.owner.tenantId !== record.tenantId) problems.push(err("/owner/tenantId", "ejerskabet skal være i samme tenant som posten"));
  if (!/^[a-f0-9]{64}$/.test(record.dedupKey ?? "")) problems.push(err("/dedupKey", `posten '${record.reference}' mangler en gyldig dedup-nøgle`));
  if (!(record.version >= 1)) problems.push(err("/version", `posten '${record.reference}' skal have en positiv version`));
  if (record.acl && (!Array.isArray(record.acl.readSubjects) || !Array.isArray(record.acl.readGroups))) {
    problems.push(err("/acl", "postens ACL skal angive læsere som lister"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Exit-eksport                                                               */
/* -------------------------------------------------------------------------- */

export function migrationExportProblems(exported) {
  const problems = [];
  if (!exported || typeof exported !== "object") return [err("/", "eksporten er ikke et objekt")];
  if (!(exported.recordCount >= 0)) problems.push(err("/recordCount", "antallet af poster skal være ikke-negativt"));
  if (!/^[a-f0-9]{64}$/.test(exported.checksum ?? "")) problems.push(err("/checksum", "eksportens checksum skal være en sha256"));
  if (exported.readableWithoutPlatform !== true) problems.push(err("/readableWithoutPlatform", "eksporten skal kunne læses uden platformen"));
  const includes = exported.includes ?? {};
  for (const facet of COVERAGE_FACETS) {
    if (includes[facet] !== true) problems.push(err(`/includes/${facet}`, `eksporten skal inkludere faceten '${facet}'`));
  }
  if (!(exported.files ?? []).length) problems.push(err("/files", "eksporten skal indeholde mindst én fil"));
  for (const [i, file] of (exported.files ?? []).entries()) {
    if (!file.path || !file.mediaType) problems.push(err(`/files/${i}`, "en eksportfil skal angive sti og medietype"));
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) problems.push(err(`/files/${i}/sha256`, "en eksportfil skal have en sha256"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Pilotgodkendelse                                                           */
/* -------------------------------------------------------------------------- */

export const APPROVAL_METHODS = ["two-person-review", "pilot-user-sign-off"];

export function migrationApprovalProblems(approval, { operatorSubject = null, tenantId = null, appId = null } = {}) {
  const problems = [];
  if (!approval || typeof approval !== "object") return [err("/", "godkendelsen er ikke et objekt")];
  if (!isNamedHuman(approval.approvedBy)) problems.push(err("/approvedBy", "godkendelsen skal komme fra et navngivet menneske"));
  if (approval.contentApproved !== true) problems.push(err("/contentApproved", "pilotbrugeren skal godkende indholdet"));
  if (approval.aclApproved !== true) problems.push(err("/aclApproved", "pilotbrugeren skal godkende adgangsrettighederne"));
  if (!APPROVAL_METHODS.includes(approval.method)) problems.push(err("/method", `den ukendte godkendelsesmetode '${approval.method}'`));
  if (!(approval.evidenceRef ?? "").trim()) problems.push(err("/evidenceRef", "godkendelsen skal pege på sit bevis"));
  if (tenantId && approval.tenantId !== tenantId) problems.push(err("/tenantId", "godkendelsen tilhører en anden tenant"));
  if (appId && approval.appId !== appId) problems.push(err("/appId", "godkendelsen tilhører en anden app"));
  if (operatorSubject && approval.approvedBy?.subject === operatorSubject) {
    problems.push(err("/approvedBy", "den der udførte migrationen kan ikke selv godkende den"));
  }
  return problems;
}
