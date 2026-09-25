/**
 * DKC-059 — model og beslutningssemantik for providerkontrakter.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - hvert providerklasse-katalog har et navngivet menneske som ejer og et
 *     versionsstyret capability-sæt med obligatoriske og sikkerhedskritiske
 *     capabilities,
 *   - hvert providerregister erklærer klasse, produkt, version/edition,
 *     forbindelsesform og hvilke capabilities (med version og niveau) den
 *     tilbyder,
 *   - supportmatricen klassificerer hvert skift som drop-in, planlagt
 *     datamigration eller ikke-understøttet — aldrig som et generelt løfte,
 *   - politikken kræver capability-forhandling, at en manglende obligatorisk
 *     capability stopper skiftet, at sikkerhedskritiske semantikker ikke kan
 *     nedgraderes, at en forbindelsesstreng aldrig omgår gaten, og at cutover
 *     kræver afstemning, rollback, read-only gammel provider og
 *     credentialrevokation, og
 *   - en swap-fixture peger på et klassificeret skift og erklærer stabil
 *     reference, ejerskab, ACL og links pr. post.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const CATALOG_PATH = "provider-registry/capabilities.json";
export const PROVIDERS_PATH = "provider-registry/providers.json";
export const MATRIX_PATH = "provider-registry/support-matrix.json";
export const POLICY_PATH = "provider-registry/policy.json";
export const SWAPS_DIR = "provider-registry/swaps";
export const REPORT_PATH = "provider-registry/report/provider-report.json";
export const REPORT_DOC_PATH = "docs/provider/provider-report.md";
export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

export const PROVIDER_CLASSES = ["iam", "modelprovider", "database", "storage", "backup", "queue", "apps"];
export const SWAP_MODES = ["drop-in", "planned-migration", "unsupported"];
export const CAPABILITY_LEVELS = ["enforced", "advisory"];
export const CAPABILITY_LEVEL_RANK = { enforced: 2, advisory: 1 };

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadCatalog(root) {
  return readJson(root, CATALOG_PATH);
}
export function loadProviders(root) {
  return readJson(root, PROVIDERS_PATH);
}
export function loadMatrix(root) {
  return readJson(root, MATRIX_PATH);
}
export function loadPolicy(root) {
  return readJson(root, POLICY_PATH);
}
export function loadSwapFixtures(root) {
  const dir = join(root, SWAPS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, fixture: JSON.parse(readFileSync(join(dir, file), "utf8")) }));
}
export function loadAll(root) {
  return { catalog: loadCatalog(root), providers: loadProviders(root), matrix: loadMatrix(root), policy: loadPolicy(root), swaps: loadSwapFixtures(root) };
}

export function capabilityById(catalog, id) {
  return (catalog?.capabilities ?? []).find((c) => c.id === id) ?? null;
}
export function providerById(providers, id) {
  return (providers?.providers ?? []).find((p) => p.id === id) ?? null;
}
export function capabilitiesForClass(catalog, classId) {
  return (catalog?.capabilities ?? []).filter((c) => c.class === classId);
}
export function levelRank(level) {
  return CAPABILITY_LEVEL_RANK[level] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Capability-katalog                                                         */
/* -------------------------------------------------------------------------- */

export function capabilityCatalogProblems(catalog, { requireAllClasses = true } = {}) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return [err("/", "capability-kataloget er ikke et objekt")];
  if (!isNamedHuman(catalog.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "capability-kataloget skal have et navngivet menneske som ejer"));
  }
  const classIds = new Set();
  for (const [i, c] of (catalog.classes ?? []).entries()) {
    const at = `/classes/${i}`;
    if (!c.id || classIds.has(c.id)) problems.push(err(`${at}/id`, `providerklassen '${c.id}' er ugyldig eller dubleret`));
    classIds.add(c.id);
    if (!(c.title ?? "").trim()) problems.push(err(`${at}/title`, `providerklassen '${c.id}' mangler en titel`));
  }
  for (const cls of PROVIDER_CLASSES) {
    if (requireAllClasses && !classIds.has(cls)) problems.push(err("/classes", `providerklassen '${cls}' mangler`));
  }
  const levelIds = new Set((catalog.levels ?? []).map((l) => l.id));
  for (const level of CAPABILITY_LEVELS) {
    if (!levelIds.has(level)) problems.push(err("/levels", `håndhævelsesniveauet '${level}' mangler`));
  }
  const ids = new Set();
  const mandatoryPerClass = new Map();
  for (const [i, cap] of (catalog.capabilities ?? []).entries()) {
    const at = `/capabilities/${i}`;
    if (!cap.id || ids.has(cap.id)) problems.push(err(`${at}/id`, `capability'en '${cap.id}' er ugyldig eller dubleret`));
    ids.add(cap.id);
    if (!classIds.has(cap.class)) problems.push(err(`${at}/class`, `capability'en '${cap.id}' peger på den ukendte klasse '${cap.class}'`));
    if (typeof cap.mandatory !== "boolean") problems.push(err(`${at}/mandatory`, `capability'en '${cap.id}' skal angive om den er obligatorisk`));
    if (typeof cap.securityCritical !== "boolean") problems.push(err(`${at}/securityCritical`, `capability'en '${cap.id}' skal angive om den er sikkerhedskritisk`));
    if (!/^\d+\.\d+\.\d+/.test(cap.minVersion ?? "")) problems.push(err(`${at}/minVersion`, `capability'en '${cap.id}' mangler en gyldig minimumsversion`));
    if (cap.mandatory) mandatoryPerClass.set(cap.class, (mandatoryPerClass.get(cap.class) ?? 0) + 1);
  }
  for (const cls of PROVIDER_CLASSES) {
    if (requireAllClasses && !mandatoryPerClass.get(cls)) problems.push(err("/capabilities", `providerklassen '${cls}' har ingen obligatoriske capabilities`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Providerregister                                                           */
/* -------------------------------------------------------------------------- */

export function providerRegistryProblems(registry, { catalog = null } = {}) {
  const problems = [];
  if (!registry || typeof registry !== "object") return [err("/", "providerregistret er ikke et objekt")];
  if (!isNamedHuman(registry.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "providerregistret skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  const connectionKeys = new Set();
  for (const [i, provider] of (registry.providers ?? []).entries()) {
    const at = `/providers/${i}`;
    if (!provider.id || ids.has(provider.id)) problems.push(err(`${at}/id`, `provideren '${provider.id}' er ugyldig eller dubleret`));
    ids.add(provider.id);
    if (!PROVIDER_CLASSES.includes(provider.class)) problems.push(err(`${at}/class`, `provideren '${provider.id}' har den ukendte klasse '${provider.class}'`));
    if (!/^\d+\.\d+\.\d+/.test(provider.version ?? "")) problems.push(err(`${at}/version`, `provideren '${provider.id}' mangler en gyldig version`));
    if (!(provider.connection?.scheme ?? "").trim()) problems.push(err(`${at}/connection/scheme`, `provideren '${provider.id}' mangler en forbindelsesform`));
    // To providere af samme klasse i samme tenant må dele endpoint; derfor er en
    // gentaget forbindelsesstreng ikke i sig selv en fejl. Vi registrerer den
    // blot, fordi et identisk endpoint aldrig må bruges som bevis på et skift.
    connectionKeys.add(`${provider.class}:${provider.connection?.scheme}:${provider.connection?.endpoint}`);
    if (!Object.keys(provider.capabilities ?? {}).length) {
      problems.push(err(`${at}/capabilities`, `provideren '${provider.id}' erklærer ingen capabilities`));
    }
    for (const [capId, entry] of Object.entries(provider.capabilities ?? {})) {
      const cap = catalog ? capabilityById(catalog, capId) : null;
      if (catalog && !cap) {
        problems.push(err(`${at}/capabilities/${capId}`, `provideren '${provider.id}' erklærer den ukendte capability '${capId}'`));
        continue;
      }
      if (cap && cap.class !== provider.class) {
        problems.push(err(`${at}/capabilities/${capId}`, `capability'en '${capId}' tilhører klassen '${cap.class}', ikke '${provider.class}'`));
      }
      if (!CAPABILITY_LEVELS.includes(entry?.level)) {
        problems.push(err(`${at}/capabilities/${capId}/level`, `capability'en '${capId}' hos '${provider.id}' har et ukendt niveau`));
      }
      if (!/^\d+\.\d+\.\d+/.test(entry?.version ?? "")) {
        problems.push(err(`${at}/capabilities/${capId}/version`, `capability'en '${capId}' hos '${provider.id}' mangler en version`));
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Supportmatrix                                                              */
/* -------------------------------------------------------------------------- */

export function supportMatrixProblems(matrix, { providers = null, catalog = null } = {}) {
  const problems = [];
  if (!matrix || typeof matrix !== "object") return [err("/", "supportmatricen er ikke et objekt")];
  if (!isNamedHuman(matrix.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "supportmatricen skal have et navngivet menneske som ejer"));
  }
  const modeIds = new Set((matrix.modes ?? []).map((m) => m.id));
  for (const mode of SWAP_MODES) {
    if (!modeIds.has(mode)) problems.push(err("/modes", `skiftetilstanden '${mode}' mangler`));
  }
  const ids = new Set();
  const toSets = new Set();
  for (const [i, row] of (matrix.rows ?? []).entries()) {
    const at = `/rows/${i}`;
    if (!row.id || ids.has(row.id)) problems.push(err(`${at}/id`, `matricerækken '${row.id}' er ugyldig eller dubleret`));
    ids.add(row.id);
    if (!PROVIDER_CLASSES.includes(row.class)) problems.push(err(`${at}/class`, `matricerækken '${row.id}' har den ukendte klasse '${row.class}'`));
    if (!SWAP_MODES.includes(row.mode)) problems.push(err(`${at}/mode`, `matricerækken '${row.id}' har den ukendte tilstand '${row.mode}'`));
    if (!(row.reason ?? "").trim()) problems.push(err(`${at}/reason`, `matricerækken '${row.id}' mangler en begrundelse`));
    if (row.from === row.to) problems.push(err(at, `matricerækken '${row.id}' peger på sig selv`));
    if (providers) {
      const from = providerById(providers, row.from);
      const to = providerById(providers, row.to);
      if (!from) problems.push(err(`${at}/from`, `matricerækken '${row.id}' peger på den ukendte provider '${row.from}'`));
      if (!to) problems.push(err(`${at}/to`, `matricerækken '${row.id}' peger på den ukendte provider '${row.to}'`));
      if (from && from.class !== row.class) problems.push(err(`${at}/class`, `matricerækken '${row.id}' erklærer klassen '${row.class}', men '${row.from}' er '${from.class}'`));
      if (to && to.class !== row.class) problems.push(err(`${at}/class`, `matricerækken '${row.id}' erklærer klassen '${row.class}', men '${row.to}' er '${to.class}'`));
      if (from && to && from.class !== to.class) problems.push(err(at, `matricerækken '${row.id}' skifter mellem klasserne '${from.class}' og '${to.class}'`));
    }
    const key = `${row.class}:${row.from}:${row.to}`;
    if (toSets.has(key)) problems.push(err(at, `matricerækken '${row.id}' gentager et skift`));
    toSets.add(key);
    if (row.mode === "planned-migration") {
      if (row.requiresMigrationProof !== true) problems.push(err(`${at}/requiresMigrationProof`, `en planlagt migration '${row.id}' skal kræve et migrationsbevis`));
      if (row.requiresDataMigration !== true) problems.push(err(`${at}/requiresDataMigration`, `en planlagt migration '${row.id}' skal kræve datamigration`));
      if (row.requiresHumanApproval !== true) problems.push(err(`${at}/requiresHumanApproval`, `en planlagt migration '${row.id}' skal kræve en menneskelig godkendelse`));
      if (row.requiresRollback !== true) problems.push(err(`${at}/requiresRollback`, `en planlagt migration '${row.id}' skal kræve rollback`));
      if (row.requiresIdMapping !== true) problems.push(err(`${at}/requiresIdMapping`, `en planlagt migration '${row.id}' skal kræve id-mapping`));
    }
    if (row.mode === "unsupported" && (row.requiresDataMigration || row.requiresMigrationProof)) {
      problems.push(err(at, `det ikke-understøttede skift '${row.id}' må ikke kræve en migration`));
    }
    if (row.mode === "drop-in" && (row.requiresDataMigration || row.requiresMigrationProof)) {
      problems.push(err(at, `drop-in-skiftet '${row.id}' må ikke kræve en datamigration`));
    }
    if (row.mode === "drop-in" && row.requiresIdMapping === true) {
      problems.push(err(`${at}/requiresIdMapping`, `drop-in-skiftet '${row.id}' må ikke kræve id-mapping`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Politik                                                                    */
/* -------------------------------------------------------------------------- */

export function swapPolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "providerpolitikken er ikke et objekt")];
  if (!isNamedHuman(policy.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "providerpolitikken skal have et navngivet menneske som ejer"));
  }
  const auth = policy.authorization ?? {};
  if (auth.defaultDeny !== true) problems.push(err("/authorization/defaultDeny", "adgang skal være default-deny"));
  if (auth.tenantIsolation !== true) problems.push(err("/authorization/tenantIsolation", "tenants skal være isoleret"));
  if (auth.roleProtection !== true) problems.push(err("/authorization/roleProtection", "roller skal beskyttes"));
  if (auth.revalidateAtRead !== true) problems.push(err("/authorization/revalidateAtRead", "adgang skal revalideres ved læsning"));
  if (auth.crossTenantSwap !== false) problems.push(err("/authorization/crossTenantSwap", "skift på tværs af tenants er forbudt"));

  const neg = policy.negotiation ?? {};
  if (neg.requireAllMandatoryCapabilities !== true) problems.push(err("/negotiation/requireAllMandatoryCapabilities", "alle obligatoriske capabilities skal kræves"));
  if (neg.securityCriticalCannotDowngrade !== true) problems.push(err("/negotiation/securityCriticalCannotDowngrade", "en sikkerhedskritisk capability må ikke nedgraderes"));
  if (neg.unknownCapabilityDenied !== true) problems.push(err("/negotiation/unknownCapabilityDenied", "en ukendt capability skal afvises"));
  if (neg.allowDegradedOptional !== false) problems.push(err("/negotiation/allowDegradedOptional", "en valgfri capability må ikke stiltiende nedgraderes"));
  if (neg.connectionStringNeverBypassesGate !== true) problems.push(err("/negotiation/connectionStringNeverBypassesGate", "en forbindelsesstreng må ikke omgå gaten"));
  if (neg.requireExplicitCompatibilityRow !== true) problems.push(err("/negotiation/requireExplicitCompatibilityRow", "hvert skift skal have en eksplicit kompatibilitetsrække"));

  const cut = policy.cutover ?? {};
  if (cut.requiresPreflight !== true) problems.push(err("/cutover/requiresPreflight", "cutover skal kræve en preflight"));
  if (cut.requiresReconciliation !== true) problems.push(err("/cutover/requiresReconciliation", "cutover skal kræve en afstemning"));
  if (cut.requiresMigrationProofForPlanned !== true) problems.push(err("/cutover/requiresMigrationProofForPlanned", "en planlagt migration skal kræve et migrationsbevis"));
  if (cut.requiresHumanApproval !== true) problems.push(err("/cutover/requiresHumanApproval", "cutover skal kræve en menneskelig godkendelse"));
  if (cut.approvalMustBeHuman !== true) problems.push(err("/cutover/approvalMustBeHuman", "godkendelsen skal komme fra et menneske"));
  if (cut.twoPerson !== true) problems.push(err("/cutover/twoPerson", "cutover skal kræve to-personers-kontrol"));
  if (cut.oldProviderReadOnly !== true) problems.push(err("/cutover/oldProviderReadOnly", "den gamle provider skal sættes read-only"));
  if (cut.requiresRollback !== true) problems.push(err("/cutover/requiresRollback", "cutover skal kræve en rollback"));
  if (cut.rollbackRestoresRights !== true) problems.push(err("/cutover/rollbackRestoresRights", "rollback skal gendanne rettigheder"));

  const off = policy.offboarding ?? {};
  if (off.revokeCredentials !== true) problems.push(err("/offboarding/revokeCredentials", "gamle credentials skal tilbagekaldes"));
  if (off.removeActiveRights !== true) problems.push(err("/offboarding/removeActiveRights", "aktive rettigheder skal fjernes"));
  if (off.retainEvidence !== true) problems.push(err("/offboarding/retainEvidence", "nødvendig evidens skal bevares"));
  if (!(off.evidenceRetentionDays >= 1)) problems.push(err("/offboarding/evidenceRetentionDays", "evidens skal have en positiv retention"));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Swap-fixture                                                               */
/* -------------------------------------------------------------------------- */

const REFERENCE_RE = /^mig:([a-z0-9][a-z0-9-]{1,62}):([a-z]+):([A-Za-z]+):([A-Za-z0-9._-]+)$/;

export function swapFixtureProblems(fixture, { providers = null, matrix = null } = {}) {
  const problems = [];
  if (!fixture || typeof fixture !== "object") return [err("/", "swap-fixturen er ikke et objekt")];
  if (!(fixture.id ?? "").trim()) problems.push(err("/id", "swap-fixturen skal have et id"));
  if (!PROVIDER_CLASSES.includes(fixture.class)) problems.push(err("/class", `swap-fixturen har den ukendte klasse '${fixture.class}'`));
  if (!SWAP_MODES.includes(fixture.mode)) problems.push(err("/mode", `swap-fixturen har den ukendte tilstand '${fixture.mode}'`));
  if (!(fixture.from ?? "").trim() || !(fixture.to ?? "").trim()) problems.push(err("/from", "swap-fixturen skal angive from og to"));
  if ((fixture.tenantId ?? "").length < 2) problems.push(err("/tenantId", "swap-fixturen skal angive en tenant"));
  if (providers) {
    const from = providerById(providers, fixture.from);
    const to = providerById(providers, fixture.to);
    if (!from) problems.push(err("/from", `swap-fixturen peger på den ukendte provider '${fixture.from}'`));
    if (!to) problems.push(err("/to", `swap-fixturen peger på den ukendte provider '${fixture.to}'`));
    if (from && from.class !== fixture.class) problems.push(err("/class", `swap-fixturens klasse '${fixture.class}' stemmer ikke med '${fixture.from}'`));
    if (to && to.class !== fixture.class) problems.push(err("/class", `swap-fixturens klasse '${fixture.class}' stemmer ikke med '${fixture.to}'`));
  }
  if (matrix) {
    const row = (matrix.rows ?? []).find((r) => r.class === fixture.class && r.from === fixture.from && r.to === fixture.to);
    if (!row) problems.push(err("/from", `swap-fixturen '${fixture.id}' mangler en kompatibilitetsrække`));
    else if (row.mode !== fixture.mode) problems.push(err("/mode", `swap-fixturens tilstand '${fixture.mode}' stemmer ikke med matricen '${row.mode}'`));
  }
  const refs = new Set();
  const sourceIds = new Set();
  for (const [i, record] of (fixture.records ?? []).entries()) {
    const at = `/records/${i}`;
    if (!(record.sourceId ?? "").toString().trim()) problems.push(err(`${at}/sourceId`, "en post skal have et kilde-id"));
    if (sourceIds.has(String(record.sourceId))) problems.push(err(`${at}/sourceId`, `kilde-id'et '${record.sourceId}' er dubleret`));
    sourceIds.add(String(record.sourceId));
    const match = REFERENCE_RE.exec(record.references?.[0] ?? "");
    if (!match) {
      problems.push(err(`${at}/references`, `posten '${record.sourceId}' mangler en stabil reference`));
    } else {
      if (match[1] !== fixture.tenantId) problems.push(err(`${at}/references`, `referencen '${record.references[0]}' tilhører en anden tenant`));
      if (refs.has(record.references[0])) problems.push(err(`${at}/references`, `referencen '${record.references[0]}' er dubleret`));
      refs.add(record.references[0]);
    }
    if (record.owner?.tenantId !== fixture.tenantId) problems.push(err(`${at}/owner/tenantId`, `posten '${record.sourceId}' skal have ejerskab i samme tenant`));
    if (!Array.isArray(record.acl?.readSubjects) || !Array.isArray(record.acl?.readGroups)) {
      problems.push(err(`${at}/acl`, `posten '${record.sourceId}' skal angive læsere som lister`));
    }
    for (const link of record.links ?? []) {
      if (!REFERENCE_RE.test(link.reference ?? "")) problems.push(err(`${at}/links`, `posten '${record.sourceId}' har et link uden en stabil reference`));
    }
  }
  if (!(fixture.records ?? []).length) problems.push(err("/records", "swap-fixturen skal indeholde mindst én post"));
  return problems;
}
