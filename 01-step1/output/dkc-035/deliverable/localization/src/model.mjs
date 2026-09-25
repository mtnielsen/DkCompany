/**
 * DKC-035 — semantik for modulregistrering af økonomi, HR og handel.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - en modulfamilie er versioneret, har en begrundet rækkefølge og et
 *     eksplicit fravalg,
 *   - hver katalogkomponent bærer en `localization`-blok der binder den til
 *     familien, dens data-klasser, lokaliseringskravene og adaptergrænsefladen,
 *   - dansk bogføring, moms, e-faktura og løn er særskilte gates: et
 *     `unreviewed`/`pending` krav blokerer 'Danmarksklar', uanset hvor komplet
 *     upstream-produktet er,
 *   - betaling og bankadgang kræver en godkendt ekstern tjeneste med begrænsede
 *     scopes; fuld bankadgang og kortdata er eksplicit forbudt.
 *
 * Validatorerne returnerer arrays af `{ path, message }` (ikke `{ ok, errors }`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const FAMILIES_PATH = "localization/families.json";
export const LOCALE_REQUIREMENTS_PATH = "localization/locale-requirements.json";
export const ADAPTER_INTERFACES_PATH = "localization/adapter-interfaces.json";
export const REPORT_PATH = "localization/report/localization-report.json";
export const REPORT_DOC_PATH = "docs/localization/module-registration-report.md";

export const FAMILY_IDS = ["finance", "hr", "time", "invoicing", "commerce"];
export const FAMILY_STATUSES = ["registered", "candidate", "pending-legal-review", "unavailable"];
export const LOCALE_REQUIREMENT_IDS = ["accounting", "vat", "e-invoicing", "payroll", "payment", "agreements", "authoritative-registers"];
export const DATA_CLASSES = ["none", "operational", "personal", "special-category", "financial"];
export const OPS_VERBS = ["backup", "restore", "verify-restore", "drain", "upgrade.dry-run", "upgrade", "migrate", "rollback", "health", "slo"];
export const LOCALE_STATUSES = ["unreviewed", "pending", "confirmed", "not-applicable"];
export const DEFAULT_REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

/** Den kanoniske udledning af en families status ud fra dens gates. */
export function deriveFamilyStatus(family, requirements = [], interfaces = []) {
  const reqs = (family.localeRequirements ?? []).map((id) => requirements.find((r) => r.id === id)).filter(Boolean);
  const iface = interfaces.find((i) => i.id === family.adapterInterface);
  const blocking = reqs.filter((r) => r.gate?.blocksDanishReady === true);
  if (blocking.some((r) => r.status !== "confirmed")) return "pending-legal-review";
  if (iface?.externalServiceRequired === true && !iface.approvedExternalServiceRef) return "pending-legal-review";
  return "registered";
}

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadFamilies(root) {
  return readJson(root, FAMILIES_PATH);
}
export function loadLocaleRequirements(root) {
  return readJson(root, LOCALE_REQUIREMENTS_PATH);
}
export function loadAdapterInterfaces(root) {
  return readJson(root, ADAPTER_INTERFACES_PATH);
}
export function loadAll(root) {
  return {
    families: loadFamilies(root),
    requirements: loadLocaleRequirements(root),
    interfaces: loadAdapterInterfaces(root),
  };
}

function namedHumanProblems(data, path) {
  if (!isNamedHuman(data?.accountableHuman)) {
    return [err(path, "skal have et navngivet menneske som ansvarlig, ikke et team-alias eller en rolle uden person")];
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* Lokaliseringskrav                                                          */
/* -------------------------------------------------------------------------- */

export function localeRequirementProblems(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return [err("/", "lokaliseringskataloget er ikke et objekt")];
  problems.push(...namedHumanProblems(catalog.metadata, "/metadata/accountableHuman"));
  const ids = new Set();
  for (const [i, req] of (catalog.requirements ?? []).entries()) {
    const at = `/requirements/${i}`;
    if (ids.has(req.id)) problems.push(err(`${at}/id`, `kravet '${req.id}' er erklæret flere gange`));
    ids.add(req.id);
    if (!LOCALE_REQUIREMENT_IDS.includes(req.id)) problems.push(err(`${at}/id`, `det ukendte lokaliseringskrav '${req.id}'`));
    for (const fam of req.appliesToFamilies ?? []) {
      if (!FAMILY_IDS.includes(fam)) problems.push(err(`${at}/appliesToFamilies`, `den ukendte familie '${fam}'`));
    }
    if (!LOCALE_STATUSES.includes(req.status)) problems.push(err(`${at}/status`, `den ukendte status '${req.status}'`));
    if (req.gate?.blocksDanishReady === true && req.gate?.required !== true) {
      problems.push(err(`${at}/gate`, "et blokerende krav skal også være 'required'"));
    }
    if (req.status === "confirmed" || req.status === "not-applicable") {
      if (!isNamedHuman(req.reviewedBy)) problems.push(err(`${at}/reviewedBy`, `kravet '${req.id}' er '${req.status}' og skal have et navngivet menneske`));
      if (!req.reviewedAt) problems.push(err(`${at}/reviewedAt`, `kravet '${req.id}' er '${req.status}' og skal have et review-tidspunkt`));
      if (!(req.evidence ?? []).length) problems.push(err(`${at}/evidence`, `kravet '${req.id}' er '${req.status}' og skal have mindst ét bevis`));
    }
    if (req.status === "unreviewed" && (req.reviewedBy || req.reviewedAt)) {
      problems.push(err(`${at}/reviewedBy`, `kravet '${req.id}' er 'unreviewed' og må ikke have et review`));
    }
    if (req.status === "pending" && req.reviewedAt) {
      problems.push(err(`${at}/reviewedAt`, `kravet '${req.id}' er 'pending' og må ikke have et review-tidspunkt`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Adaptergrænseflader                                                        */
/* -------------------------------------------------------------------------- */

export function adapterInterfaceProblems(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return [err("/", "adaptergrænsefladekataloget er ikke et objekt")];
  problems.push(...namedHumanProblems(catalog.metadata, "/metadata/accountableHuman"));
  const ids = new Set();
  for (const [i, iface] of (catalog.interfaces ?? []).entries()) {
    const at = `/interfaces/${i}`;
    if (ids.has(iface.id)) problems.push(err(`${at}/id`, `grænsefladen '${iface.id}' er erklæret flere gange`));
    ids.add(iface.id);
    if (!FAMILY_IDS.includes(iface.family)) problems.push(err(`${at}/family`, `den ukendte familie '${iface.family}'`));
    for (const verb of iface.verbs ?? []) {
      if (!OPS_VERBS.includes(verb)) problems.push(err(`${at}/verbs`, `det ukendte verbum '${verb}'`));
    }
    const scopeIds = new Set();
    for (const scope of iface.scopes ?? []) {
      if (scopeIds.has(scope.id)) problems.push(err(`${at}/scopes`, `scopet '${scope.id}' er erklæret flere gange`));
      scopeIds.add(scope.id);
      if (!["read", "write"].includes(scope.access)) problems.push(err(`${at}/scopes/${scope.id}/access`, "et scope skal være read eller write"));
    }
    for (const dc of iface.dataClasses ?? []) {
      if (!DATA_CLASSES.includes(dc)) problems.push(err(`${at}/dataClasses`, `den ukendte dataklasse '${dc}'`));
    }
    if ((iface.scopes ?? []).some((s) => /bank:full-access|cards:|accounts:full-access/.test(s.id))) {
      problems.push(err(`${at}/scopes`, "en grænseflade må ikke erklære fuld bankadgang eller kortdata som et tilladt scope"));
    }
    if (iface.externalServiceRequired === true) {
      if (!(iface.scopes ?? []).length) problems.push(err(`${at}/scopes`, "en ekstern tjeneste skal bruge mindst ét begrænset scope"));
      if (!(iface.deniedScopes ?? []).some((s) => /bank:full-access|accounts:full-access/.test(s))) {
        problems.push(err(`${at}/deniedScopes`, "en ekstern betalingstjeneste skal eksplicit forbyde fuld bank-/kontoadgang"));
      }
      const approved = iface.approvedExternalServiceRef;
      if (approved && !/^(vault|kms|contract|approved):/.test(approved)) {
        problems.push(err(`${at}/approvedExternalServiceRef`, "en godkendt ekstern tjeneste skal refereres med en navngivet reference"));
      }
    }
    if (iface.legalReviewRequired === true && !(iface.dataClasses ?? []).length) {
      problems.push(err(`${at}/dataClasses`, "en grænseflade med juridisk review skal angive sine dataklasser"));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Modulfamilier                                                              */
/* -------------------------------------------------------------------------- */

export function familyCatalogProblems(catalog, { components = [], requirements = null, interfaces = null, exampleFiles = null } = {}) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return [err("/", "familiekataloget er ikke et objekt")];
  problems.push(...namedHumanProblems(catalog.metadata, "/metadata/accountableHuman"));
  const componentIds = new Set(components.map((c) => (c.data ?? c).metadata?.name).filter(Boolean));
  const requirementIds = new Set((requirements?.requirements ?? []).map((r) => r.id));
  const interfaceIds = new Set((interfaces?.interfaces ?? []).map((i) => i.id));
  const exampleSet = exampleFiles ? new Set(exampleFiles) : null;

  const ids = new Set();
  const orders = new Set();
  for (const [i, family] of (catalog.families ?? []).entries()) {
    const at = `/families/${i}`;
    if (ids.has(family.id)) problems.push(err(`${at}/id`, `familien '${family.id}' er erklæret flere gange`));
    ids.add(family.id);
    if (!FAMILY_IDS.includes(family.id)) problems.push(err(`${at}/id`, `den ukendte familie '${family.id}'`));
    if (orders.has(family.order)) problems.push(err(`${at}/order`, `rækkefølgen '${family.order}' er brugt flere gange`));
    orders.add(family.order);
    if (!FAMILY_STATUSES.includes(family.familyStatus)) problems.push(err(`${at}/familyStatus`, `den ukendte familiestatus '${family.familyStatus}'`));
    for (const comp of family.components ?? []) {
      if (componentIds.size && !componentIds.has(comp)) problems.push(err(`${at}/components`, `komponenten '${comp}' findes ikke i kataloget`));
    }
    for (const req of family.localeRequirements ?? []) {
      if (requirementIds.size && !requirementIds.has(req)) problems.push(err(`${at}/localeRequirements`, `lokaliseringskravet '${req}' findes ikke`));
      const requirement = (requirements?.requirements ?? []).find((r) => r.id === req);
      if (requirement && !requirement.appliesToFamilies.includes(family.id)) {
        problems.push(err(`${at}/localeRequirements`, `kravet '${req}' gælder ikke familien '${family.id}'`));
      }
    }
    if (interfaceIds.size && !interfaceIds.has(family.adapterInterface)) {
      problems.push(err(`${at}/adapterInterface`, `adaptergrænsefladen '${family.adapterInterface}' findes ikke`));
    }
    const selected = (family.candidateProducts ?? []).filter((c) => c.selected === true);
    if (selected.length !== 1 && family.familyStatus !== "unavailable") {
      problems.push(err(`${at}/candidateProducts`, `familien '${family.id}' skal have præcis én valgt kandidat (har ${selected.length})`));
    }
    for (const candidate of family.candidateProducts ?? []) {
      if (exampleSet && !exampleSet.has(candidate.candidateRef)) {
        problems.push(err(`${at}/candidateProducts`, `kandidatfilen '${candidate.candidateRef}' findes ikke i contracts/examples`));
      }
    }
  }
  for (const family of catalog.families ?? []) {
    const derived = deriveFamilyStatus(family, requirements?.requirements ?? [], interfaces?.interfaces ?? []);
    if (family.familyStatus !== derived) {
      problems.push(err(`/families/${family.id}/familyStatus`, `familien '${family.id}' er '${family.familyStatus}', men gates udleder '${derived}'`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Komponentens localization-blok                                             */
/* -------------------------------------------------------------------------- */

export function componentLocalizationProblems(manifest, { families = null, requirements = null, interfaces = null, exampleFiles = null } = {}) {
  const problems = [];
  const loc = manifest?.localization;
  if (!loc) return problems;
  const id = manifest?.metadata?.name ?? "?";
  if (!FAMILY_IDS.includes(loc.family)) problems.push(err("/localization/family", `'${id}' har den ukendte familie '${loc.family}'`));
  if (!FAMILY_STATUSES.includes(loc.status)) problems.push(err("/localization/status", `'${id}' har den ukendte status '${loc.status}'`));
  for (const dc of loc.dataClasses ?? []) {
    if (!DATA_CLASSES.includes(dc)) problems.push(err("/localization/dataClasses", `'${id}' har den ukendte dataklasse '${dc}'`));
  }
  const requirementIds = new Set((requirements?.requirements ?? []).map((r) => r.id));
  const interfaceIds = new Set((interfaces?.interfaces ?? []).map((i) => i.id));
  for (const req of loc.localeRequirements ?? []) {
    if (requirementIds.size && !requirementIds.has(req)) problems.push(err("/localization/localeRequirements", `'${id}' peger på det ukendte lokaliseringskrav '${req}'`));
  }
  if (interfaceIds.size && !interfaceIds.has(loc.adapterInterface)) {
    problems.push(err("/localization/adapterInterface", `'${id}' peger på den ukendte adaptergrænseflade '${loc.adapterInterface}'`));
  }
  if (exampleFiles) {
    const exampleSet = new Set(exampleFiles);
    if (!exampleSet.has(loc.candidateRef)) problems.push(err("/localization/candidateRef", `'${id}' peger på kandidatfilen '${loc.candidateRef}', som ikke findes`));
  }
  const family = (families?.families ?? []).find((f) => f.id === loc.family);
  if (family) {
    for (const req of loc.localeRequirements ?? []) {
      if (!family.localeRequirements.includes(req)) problems.push(err("/localization/localeRequirements", `'${id}' erklærer kravet '${req}', men familien '${family.id}' gør ikke`));
    }
    const derived = deriveFamilyStatus(family, requirements?.requirements ?? [], interfaces?.interfaces ?? []);
    if (loc.status !== derived) {
      problems.push(err("/localization/status", `'${id}' er '${loc.status}', men familiens gates udleder '${derived}'`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Den genererede rapport                                                     */
/* -------------------------------------------------------------------------- */

export function reportProblems(report) {
  const problems = [];
  if (report?.kind !== "ModuleRegistrationReport") problems.push(err("/kind", "rapporten skal være en ModuleRegistrationReport"));
  const families = report?.families ?? [];
  const ids = new Set();
  for (const family of families) {
    if (ids.has(family.id)) problems.push(err(`/families/${family.id}`, "familien optræder flere gange i rapporten"));
    ids.add(family.id);
    if (family.danishReady && (family.pendingGates ?? []).length > 0) {
      problems.push(err(`/families/${family.id}/danishReady`, "en familie kan ikke være danskklar med afventende blokerende gates"));
    }
    if (family.danishReady && family.candidate?.gateStatus !== "approved") {
      problems.push(err(`/families/${family.id}/danishReady`, "en familie kan ikke være danskklar uden en godkendt kandidat"));
    }
    if (family.payment && family.payment.approved !== true && family.danishReady) {
      problems.push(err(`/families/${family.id}/danishReady`, "en familie med betaling kan ikke være danskklar uden en godkendt tjeneste"));
    }
  }
  for (const row of report?.coverageMatrix ?? []) {
    if (!ids.has(row.family)) problems.push(err(`/coverageMatrix/${row.family}`, "dækningsmatricen peger på en ukendt familie"));
  }
  const expectedReady = families.filter((f) => f.danishReady).length;
  if (report?.summary && report.summary.danishReady !== expectedReady) {
    problems.push(err("/summary/danishReady", `opsummeringen siger '${report.summary.danishReady}', men rapporten har '${expectedReady}' danskklare familier`));
  }
  return problems;
}
