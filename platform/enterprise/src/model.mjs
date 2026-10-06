/**
 * DKC-036 — semantik for enterprise- og branchepakker.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - alle tre størrelsesprofiler deler de samme sikkerhedskontrakter, og en
 *     pakke arver dem uden at forke kontrolplanet,
 *   - hver pakke har en navngivet produktejer og en navngivet testkundekontakt
 *     med en ærlig status (en syntetisk testkunde er ikke en underskrevet aftale),
 *   - faglige krav, sektorregler og højrisiko-AI er eksplicitte, uafklarede
 *     inputs; et ubekræftet krav blokerer implementering,
 *   - en katalogpost bliver ikke automatisk til en bestilt byggeopgave.
 *
 * Validatorerne returnerer arrays af `{ path, message }` (ikke `{ ok, errors }`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const PACKAGES_PATH = "enterprise/packages.json";
export const CAPABILITIES_PATH = "enterprise/capabilities.json";
export const TCO_PATH = "metering/report/tco-comparison.json";
export const COMPANY_PROFILES_PATH = "metering/company-profiles.json";
export const PILOT_PROFILES_PATH = "pilot/business-profiles.json";
export const GATE_POLICY_PATH = "distribution/acceptance/gate-policy.json";
export const REPORT_PATH = "enterprise/report/enterprise-package-report.json";
export const REPORT_DOC_PATH = "docs/enterprise/enterprise-package-report.md";
export const DEFAULT_REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

export const PROFILE_NAMES = ["small-vps", "ha-cluster", "enterprise-dedicated"];
export const PACKAGE_IDS = ["enterprise-core", "retail-commerce", "manufacturing", "field-service", "regulated-care"];
export const SEGMENTS = ["enterprise", "commerce", "manufacturing", "field-service", "regulated"];
export const PROFESSIONAL_STATUSES = ["unreviewed", "pending", "confirmed", "not-applicable"];
export const ASSESSMENT_STATUSES = ["not-applicable", "required", "pending", "confirmed"];
export const IMPLEMENTATION_STATUSES = ["blocked", "planned", "approved", "ordered"];

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

function readJsonIfExists(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function loadPackages(root) {
  return readJson(root, PACKAGES_PATH);
}
export function loadCapabilities(root) {
  return readJson(root, CAPABILITIES_PATH);
}
export function loadTco(root) {
  return readJsonIfExists(root, TCO_PATH);
}
export function loadCompanyProfiles(root) {
  return readJsonIfExists(root, COMPANY_PROFILES_PATH);
}
export function loadPilotProfiles(root) {
  return readJsonIfExists(root, PILOT_PROFILES_PATH);
}
export function loadGatePolicy(root) {
  return readJson(root, GATE_POLICY_PATH);
}
export function loadAll(root) {
  return {
    packages: loadPackages(root),
    capabilities: loadCapabilities(root),
    tco: loadTco(root),
    companyProfiles: loadCompanyProfiles(root),
    pilotProfiles: loadPilotProfiles(root),
    gatePolicy: loadGatePolicy(root),
  };
}

function namedHumanProblems(owner, path) {
  return isNamedHuman(owner)
    ? []
    : [err(path, "skal være et navngivet menneske med subject, navn og rolle — ikke et team-alias eller en rolle uden person")];
}

/* -------------------------------------------------------------------------- */
/* Kapabilitetsregister                                                       */
/* -------------------------------------------------------------------------- */

export function capabilityCatalogProblems(catalog, components = []) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return [err("/", "kapabilitetsregisteret er ikke et objekt")];
  if (catalog.kind !== "CapabilityCatalog") problems.push(err("/kind", "registeret skal være en CapabilityCatalog"));
  problems.push(...namedHumanProblems(catalog.metadata?.accountableHuman, "/metadata/accountableHuman"));

  const provided = new Map();
  for (const entry of components) {
    const data = entry.data ?? entry;
    provided.set(data.metadata?.name, new Set(data.provides?.capabilities ?? []));
  }

  const seen = new Set();
  const declared = new Set();
  for (const [i, cap] of (catalog.capabilities ?? []).entries()) {
    const at = `/capabilities/${i}`;
    if (!cap?.id) problems.push(err(at, "kapabiliteten mangler et id"));
    if (seen.has(cap?.id)) problems.push(err(`${at}/id`, `kapabiliteten '${cap.id}' er erklæret flere gange`));
    if (cap?.id) {
      seen.add(cap.id);
      declared.add(cap.id);
    }
    if (!(cap?.providedBy ?? []).length) problems.push(err(`${at}/providedBy`, `kapabiliteten '${cap?.id ?? "?"}' har ingen udbyder`));
    for (const ref of cap?.providedBy ?? []) {
      if (!provided.has(ref)) problems.push(err(`${at}/providedBy`, `komponenten '${ref}' findes ikke i kataloget`));
      else if (!provided.get(ref).has(cap.id)) problems.push(err(`${at}/providedBy`, `komponenten '${ref}' udstiller ikke kapabiliteten '${cap.id}'`));
    }
    if (cap?.controlPlane === true) {
      const onlyCore = (cap.providedBy ?? []).length > 0 && (cap.providedBy ?? []).every((ref) => components.some((entry) => (entry.data ?? entry).metadata?.name === ref && (entry.data ?? entry).securityCore === true));
      if (!onlyCore) problems.push(err(`${at}/controlPlane`, `'${cap.id}' er markeret som kontrolplan, men udbydes ikke udelukkende af sikkerhedskerne-komponenter`));
    }
  }
  for (const entry of components) {
    const data = entry.data ?? entry;
    for (const cap of data.provides?.capabilities ?? []) {
      if (!declared.has(cap)) problems.push(err("/capabilities", `kapabiliteten '${cap}' udstilles af '${data.metadata?.name}', men findes ikke i registeret`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Fælles sikkerhedskontrakter                                                */
/* -------------------------------------------------------------------------- */

export function securityContractProblems(catalog, gatePolicy, profiles = []) {
  const problems = [];
  const sc = catalog?.securityContracts;
  if (!sc) return [err("/securityContracts", "de fælles sikkerhedskontrakter mangler")];
  const common = (gatePolicy?.gates ?? []).filter((g) => g.kind === "common" && g.mandatory === true);
  const declared = new Map((sc.contracts ?? []).map((c) => [c.id, c]));

  for (const gate of common) {
    const contract = declared.get(gate.id);
    if (!contract) {
      problems.push(err("/securityContracts/contracts", `den fælles gate '${gate.id}' fra gate-politikken mangler i pakkekataloget`));
      continue;
    }
    const expected = new Set(gate.requirementRefs ?? []);
    const actual = new Set(contract.requirementRefs ?? []);
    for (const ref of expected) if (!actual.has(ref)) problems.push(err(`/securityContracts/contracts/${gate.id}`, `kravet '${ref}' mangler`));
    for (const ref of actual) if (!expected.has(ref)) problems.push(err(`/securityContracts/contracts/${gate.id}`, `kravet '${ref}' findes ikke i gate-politikken`));
  }
  for (const id of declared.keys()) {
    if (!common.some((g) => g.id === id)) problems.push(err("/securityContracts/contracts", `kontrakten '${id}' er ikke en fælles obligatorisk gate`));
  }

  for (const name of PROFILE_NAMES) {
    if (!(sc.sharedBy ?? []).includes(name)) problems.push(err("/securityContracts/sharedBy", `størrelsesprofilen '${name}' mangler`));
  }

  const cores = [];
  for (const entry of profiles) {
    const data = entry.data ?? entry;
    const name = data.metadata?.name;
    cores.push([name, [...(data.securityCore ?? [])].sort().join(",")]);
  }
  for (const name of PROFILE_NAMES) {
    if (!cores.some(([n]) => n === name)) problems.push(err("/securityContracts", `størrelsesprofilen '${name}' findes ikke i kataloget`));
  }
  const distinct = new Set(cores.map(([, core]) => core));
  if (cores.length >= 3 && distinct.size > 1) {
    problems.push(err("/securityContracts", "de tre størrelsesprofiler deler ikke den samme sikkerhedskerne og kan derfor ikke dele de samme sikkerhedskontrakter"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Den enkelte pakke                                                          */
/* -------------------------------------------------------------------------- */

function professionalRequirementProblems(req, at) {
  const problems = [];
  if (!PROFESSIONAL_STATUSES.includes(req.status)) problems.push(err(`${at}/status`, `den ukendte status '${req.status}'`));
  if (!req.blocksImplementation && req.status !== "not-applicable") {
    problems.push(err(`${at}/status`, `kravet '${req.id}' er ikke blokerende og skal være 'not-applicable' for at undgå at fremstå afklaret`));
  }
  if (req.status === "confirmed") {
    problems.push(...namedHumanProblems(req.reviewer, `${at}/reviewer`));
    if (!req.reviewedAt) problems.push(err(`${at}/reviewedAt`, "et bekræftet krav skal have et review-tidspunkt"));
    if (!(req.evidence ?? []).length) problems.push(err(`${at}/evidence`, "et bekræftet krav skal have mindst ét bevis"));
  }
  if (req.status === "unreviewed" && (req.reviewer || req.reviewedAt)) {
    problems.push(err(`${at}/reviewer`, "et 'unreviewed' krav må ikke have et review"));
  }
  if (req.status === "pending" && req.reviewedAt) {
    problems.push(err(`${at}/reviewedAt`, "et 'pending' krav må ikke have et review-tidspunkt"));
  }
  return problems;
}

function assessmentProblems(assessment, at, label) {
  const problems = [];
  if (!ASSESSMENT_STATUSES.includes(assessment.status)) problems.push(err(`${at}/status`, `den ukendte status '${assessment.status}'`));
  if (assessment.status === "confirmed") {
    problems.push(...namedHumanProblems(assessment.reviewer, `${at}/reviewer`));
    if (!assessment.reviewedAt) problems.push(err(`${at}/reviewedAt`, `${label} er bekræftet og skal have et review-tidspunkt`));
    if (!assessment.assessmentRef) problems.push(err(`${at}/assessmentRef`, `${label} er bekræftet og skal henvise til en vurdering`));
  } else if (assessment.assessmentRef && !assessment.reviewer && !assessment.reviewedAt) {
    // En uafklaret vurdering må gerne pege på, hvad der mangler at blive vurderet.
  } else if (assessment.assessmentRef && assessment.reviewedAt) {
    problems.push(err(`${at}/reviewedAt`, `${label} er '${assessment.status}' og må ikke have et review-tidspunkt`));
  }
  return problems;
}

export function packageProblems(pkg, context = {}) {
  const problems = [];
  const { capabilities = null, components = [], profiles = [], tco = null, companyProfiles = null, exampleFiles = null } = context;
  const at = `/packages/${pkg?.id ?? "?"}`;
  const componentByName = new Map(components.map((entry) => [entry.data.metadata.name, entry.data]));
  const carrier = (pkg?.baseProfileRef && profiles.find((p) => (p.data ?? p).metadata?.name === pkg.baseProfileRef)) ?? null;
  const carrierData = carrier ? carrier.data ?? carrier : null;

  if (!SEGMENTS.includes(pkg?.segment)) problems.push(err(`${at}/segment`, `det ukendte segment '${pkg?.segment}'`));

  problems.push(...namedHumanProblems(pkg?.productOwner, `${at}/productOwner`));
  problems.push(...namedHumanProblems(pkg?.testCustomer?.contact, `${at}/testCustomer/contact`));
  if (pkg?.testCustomer?.status === "consented" && !pkg.testCustomer.contractRef) {
    problems.push(err(`${at}/testCustomer/contractRef`, "en testkunde med samtykke skal have en aftalereference"));
  }
  if (pkg?.testCustomer?.synthetic === true && pkg?.testCustomer?.status === "consented") {
    problems.push(err(`${at}/testCustomer/status`, "en syntetisk testkunde kan ikke fremstå som samtykkende uden en underskrevet aftale"));
  }

  if (!carrierData) problems.push(err(`${at}/baseProfileRef`, `størrelsesprofilen '${pkg?.baseProfileRef}' findes ikke`));

  const capById = new Map((capabilities?.capabilities ?? []).map((c) => [c.id, c]));
  const cc = pkg?.capabilityConstraints ?? {};
  const required = new Set(cc.required ?? []);
  const forbidden = new Set(cc.forbidden ?? []);
  const controlPlane = new Set(cc.controlPlane ?? []);
  for (const id of required) {
    if (forbidden.has(id)) problems.push(err(`${at}/capabilityConstraints`, `kapabiliteten '${id}' er både påkrævet og forbudt`));
  }
  for (const id of controlPlane) {
    const cap = capById.get(id);
    if (!cap) problems.push(err(`${at}/capabilityConstraints/controlPlane`, `den ukendte kontrolplans-kapabilitet '${id}'`));
    else if (cap.controlPlane !== true) problems.push(err(`${at}/capabilityConstraints/controlPlane`, `'${id}' er ikke en kontrolplans-kapabilitet`));
  }
  if (carrierData) {
    const coreSet = new Set(carrierData.securityCore ?? []);
    const coreCaps = new Set();
    for (const id of coreSet) for (const cap of componentByName.get(id)?.provides?.capabilities ?? []) coreCaps.add(cap);
    for (const id of controlPlane) {
      if (!coreCaps.has(id)) problems.push(err(`${at}/capabilityConstraints/controlPlane`, `kontrolplans-kapabiliteten '${id}' arves ikke fra størrelsesprofilen '${carrierData.metadata?.name}'`));
    }
  }

  const seenApps = new Set();
  for (const app of pkg?.apps ?? []) {
    if (seenApps.has(app)) problems.push(err(`${at}/apps`, `komponenten '${app}' er angivet flere gange`));
    seenApps.add(app);
    const component = componentByName.get(app);
    if (!component) problems.push(err(`${at}/apps`, `komponenten '${app}' findes ikke i kataloget`));
    else if (component.securityCore === true) problems.push(err(`${at}/apps`, `komponenten '${app}' er sikkerhedskerne og må ikke vælges som app — den arves fra profilen`));
  }

  let specialCategory = false;
  const ownershipClasses = new Set();
  for (const [i, own] of (pkg?.dataOwnership ?? []).entries()) {
    const oa = `${at}/dataOwnership/${i}`;
    problems.push(...namedHumanProblems(own?.owner, `${oa}/owner`));
    if (ownershipClasses.has(own?.dataClass)) problems.push(err(`${oa}/dataClass`, `dataklassen '${own.dataClass}' er angivet flere gange`));
    ownershipClasses.add(own?.dataClass);
    if (own?.dataClass === "special-category") specialCategory = true;
  }
  if (specialCategory && !["enhanced", "dedicated"].includes(pkg?.isolation?.level)) {
    problems.push(err(`${at}/isolation/level`, "særlige kategorier af persondata kræver mindst forhøjet isolation"));
  }

  const integrationRefs = new Set();
  for (const [i, integration] of (pkg?.integrations ?? []).entries()) {
    const ia = `${at}/integrations/${i}`;
    if (exampleFiles && !exampleFiles.has(integration?.candidateRef)) {
      problems.push(err(`${ia}/candidateRef`, `kandidatfilen '${integration?.candidateRef}' findes ikke i contracts/examples`));
    }
    if (integration?.availability === "unavailable" && !integration.reason) {
      problems.push(err(`${ia}/reason`, "en utilgængelig integration skal forklare hvorfor"));
    }
    integrationRefs.add(integration?.candidateRef);
  }
  if (integrationRefs.size === 0) problems.push(err(`${at}/integrations`, "pakken skal mindst nævne én integration eller et fravalg heraf"));

  const profIds = new Set();
  for (const [i, req] of (pkg?.professionalRequirements ?? []).entries()) {
    const ra = `${at}/professionalRequirements/${i}`;
    if (profIds.has(req?.id)) problems.push(err(`${ra}/id`, `kravet '${req.id}' er angivet flere gange`));
    profIds.add(req?.id);
    problems.push(...professionalRequirementProblems(req, ra));
  }

  const sector = pkg?.sectorRules ?? {};
  if (sector.status && sector.status !== "not-applicable" && !sector.assessmentRef) {
    problems.push(err(`${at}/sectorRules/assessmentRef`, "en sektorvurdering der ikke er 'not-applicable' skal pege på en vurdering"));
  }
  problems.push(...assessmentProblems(sector, `${at}/sectorRules`, "sektorvurderingen").map((p) => err(p.path, p.message)));
  if (sector.status !== "not-applicable" && !(sector.regimes ?? []).length) {
    problems.push(err(`${at}/sectorRules/regimes`, "en aktiv sektorvurdering skal nævne mindst ét regelsæt"));
  }

  const ai = pkg?.highRiskAi ?? {};
  if (ai.applicable === true) {
    if (!ai.assessmentRef) problems.push(err(`${at}/highRiskAi/assessmentRef`, "højrisiko-AI skal henvise til en særskilt vurdering"));
    if (ai.status === "not-applicable") problems.push(err(`${at}/highRiskAi/status`, "højrisiko-AI kan ikke være 'not-applicable' når den er anvendelig"));
  } else if (ai.status !== "not-applicable") {
    problems.push(err(`${at}/highRiskAi/status`, "AI der ikke er anvendelig skal være 'not-applicable'"));
  }
  problems.push(...assessmentProblems(ai, `${at}/highRiskAi`, "højrisiko-AI-vurderingen"));

  const impl = pkg?.implementation ?? {};
  if (!IMPLEMENTATION_STATUSES.includes(impl.status)) problems.push(err(`${at}/implementation/status`, `den ukendte status '${impl.status}'`));
  if (["approved", "ordered"].includes(impl.status)) {
    if (!impl.orderRef) problems.push(err(`${at}/implementation/orderRef`, "en godkendt/bestilt pakke skal have en ordrereference"));
    problems.push(...namedHumanProblems(impl.approvedBy, `${at}/implementation/approvedBy`));
    if (!impl.approvedAt) problems.push(err(`${at}/implementation/approvedAt`, "en godkendt/bestilt pakke skal have et godkendelsestidspunkt"));
  }

  if (tco) {
    const profile = (tco.profiles ?? []).find((p) => p.id === pkg?.tcoRef?.profileId);
    if (!profile) problems.push(err(`${at}/tcoRef/profileId`, `TCO-profilen '${pkg?.tcoRef?.profileId}' findes ikke`));
  }
  if (companyProfiles) {
    const ids = new Set((companyProfiles.profiles ?? []).map((p) => p.id));
    for (const ref of pkg?.demand?.businessProfileRefs ?? []) {
      if (!ids.has(ref)) problems.push(err(`${at}/demand/businessProfileRefs`, `virksomhedsprofilen '${ref}' findes ikke i metering/company-profiles.json`));
    }
  }
  if (pkg?.demand?.pilotProfileRefs && context.pilotProfiles) {
    const ids = new Set((context.pilotProfiles.profiles ?? []).map((p) => p.id));
    for (const ref of pkg.demand.pilotProfileRefs) if (!ids.has(ref)) problems.push(err(`${at}/demand/pilotProfileRefs`, `pilotprofilen '${ref}' findes ikke`));
  }

  if (!(pkg?.exclusions ?? []).length) problems.push(err(`${at}/exclusions`, "pakken skal have mindst ét begrundet fravalg"));
  if (!(pkg?.professionalRequirements ?? []).length) problems.push(err(`${at}/professionalRequirements`, "pakken skal have mindst ét fagligt krav"));
  if (!(pkg?.dataOwnership ?? []).length) problems.push(err(`${at}/dataOwnership`, "pakken skal beskrive dataejerskab for mindst én dataklasse"));
  return problems;
}

export function packageCatalogProblems(catalog, context = {}) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return [err("/", "pakkekataloget er ikke et objekt")];
  if (catalog.kind !== "EnterprisePackage") problems.push(err("/kind", "pakkekataloget skal være en EnterprisePackage"));
  problems.push(...namedHumanProblems(catalog.metadata?.accountableHuman, "/metadata/accountableHuman"));
  problems.push(...securityContractProblems(catalog, context.gatePolicy, context.profiles ?? []));

  const orders = new Set();
  const ranks = new Set();
  for (const [i, pkg] of (catalog.packages ?? []).entries()) {
    if (orders.has(pkg?.order)) problems.push(err(`/packages/${i}/order`, `rækkefølgen '${pkg.order}' er brugt flere gange`));
    orders.add(pkg?.order);
    if (ranks.has(pkg?.demand?.demandRank)) problems.push(err(`/packages/${i}/demand/demandRank`, `efterspørgselsrangen '${pkg.demand.demandRank}' er brugt flere gange`));
    ranks.add(pkg?.demand?.demandRank);
    problems.push(...packageProblems(pkg, context));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Den genererede rapport                                                     */
/* -------------------------------------------------------------------------- */

export function reportProblems(report) {
  const problems = [];
  if (report?.kind !== "EnterprisePackageReport") problems.push(err("/kind", "rapporten skal være en EnterprisePackageReport"));
  const packages = report?.packages ?? [];
  const ids = new Set();
  for (const pkg of packages) {
    if (ids.has(pkg.id)) problems.push(err(`/packages/${pkg.id}`, "pakken optræder flere gange"));
    ids.add(pkg.id);
    if (pkg.implementable && (pkg.blockers ?? []).length > 0) {
      problems.push(err(`/packages/${pkg.id}/implementable`, "en pakke kan ikke være implementerbar med blokeringer"));
    }
    if (pkg.implementation?.status === "ordered" && !pkg.buildBacklog?.length) {
      problems.push(err(`/packages/${pkg.id}/implementation`, "en bestilt pakke skal have en ordret byggeopgave"));
    }
    if (pkg.highRiskAi?.applicable === true && pkg.highRiskAi?.status !== "confirmed" && pkg.implementable) {
      problems.push(err(`/packages/${pkg.id}/implementable`, "højrisiko-AI uden bekræftet vurdering kan ikke være implementerbar"));
    }
  }
  const expected = packages.filter((p) => p.implementable).length;
  if (report?.summary && report.summary.implementable !== expected) {
    problems.push(err("/summary/implementable", `opsummeringen siger '${report.summary.implementable}', men rapporten har '${expected}' implementerbare pakker`));
  }
  const shared = packages.every((p) => p.sharedSecurityContracts === true);
  if (report?.summary && report.summary.sharedSecurityContracts !== (packages.length ? shared : false)) {
    problems.push(err("/summary/sharedSecurityContracts", "opsummeringen er uenig i pakkernes delte sikkerhedskontrakter"));
  }
  return problems;
}
