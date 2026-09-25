/**
 * DKC-033 — model og beslutningssemantik for pilotforløb og readiness.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - de tre virksomhedsprofiler er repræsentative, syntetiske og hver bundet
 *     til en understøttet installationsprofil, en tenant og de seks kritiske
 *     arbejdsgange,
 *   - hvert pilotscenarie har et forventet udfald, en kørende runner og en
 *     navngivet menneskelig ejer, og hver profil gennemfører alle seks
 *     arbejdsgange,
 *   - readiness-politikken har de krævede gates (sikkerhed, kvalitet, recovery
 *     og menneskelig vurdering), en profilbevidst HA-gate og en særskilt
 *     30-dages observation samt kundeaccept, og
 *   - en readiness-rapport kan kun være `ready` når hver aktiv, obligatorisk
 *     gate består; en grøn check, et 0-dages observation eller en manglende
 *     kundeaccept giver `not-ready`.
 *
 * Valideringsfunktionerne returnerer arrays af `{ path, message }`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";
import { stableStringify } from "../../approvals/src/binding.mjs";

export const PROFILES_PATH = "pilot/business-profiles.json";
export const SCENARIOS_PATH = "pilot/pilot-scenarios.json";
export const POLICY_PATH = "pilot/readiness-policy.json";
export const OBSERVATION_PATH = "pilot/observation.json";
export const CUSTOMER_ACCEPTANCE_PATH = "pilot/customer-acceptance.json";
export const REPORT_PATH = "pilot/report/pilot-readiness-report.json";
export const REPORT_DOC_PATH = "docs/pilot/readiness-report.md";
export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

export const SEGMENTS = ["smv", "service", "enterprise"];
export const JOURNEYS = ["login-offboarding", "daily-work", "restore", "privacy-case", "upgrade", "exit"];
export const RUNNERS = ["login-offboarding", "daily-work", "restore", "privacy-case", "upgrade", "exit"];
export const REQUIRED_GATES = ["security", "quality", "recovery", "human-assessment"];
export const GATE_STATUSES = ["passed", "failed", "pending", "not-run", "not-applicable"];
export const READINESS = ["ready", "not-ready"];
export const OBSERVATION_STATUSES = ["complete", "in-progress", "outstanding", "failed"];

const GATE_RANK = { passed: 0, "not-applicable": -1, pending: 1, "not-run": 2, failed: 3 };

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}
function exists(root, rel) {
  return existsSync(join(root, rel));
}

export function loadBusinessProfiles(root) {
  return readJson(root, PROFILES_PATH);
}
export function loadPilotScenarios(root) {
  return readJson(root, SCENARIOS_PATH);
}
export function loadReadinessPolicy(root) {
  return readJson(root, POLICY_PATH);
}
export function loadObservation(root) {
  return readJson(root, OBSERVATION_PATH);
}
export function loadCustomerAcceptance(root) {
  return readJson(root, CUSTOMER_ACCEPTANCE_PATH);
}
export function loadAll(root) {
  return {
    profiles: loadBusinessProfiles(root),
    scenarios: loadPilotScenarios(root),
    policy: loadReadinessPolicy(root),
    observation: loadObservation(root),
    customerAcceptance: loadCustomerAcceptance(root),
  };
}

export function sha256(value) {
  return "sha256:" + createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}
export function pilotDigest(value) {
  return sha256(value);
}

/** Er en gate aktiv for en konkret virksomhedsprofil? 'not-applicable' ignoreres i worst(). */
export function gateApplies(gate, profile) {
  const when = gate?.appliesWhen ?? {};
  if (when.always === true) return true;
  if (when.deploymentProfileRef !== undefined && when.deploymentProfileRef !== profile?.deploymentProfileRef) return false;
  return true;
}

export function worstGateStatus(statuses) {
  const filtered = (statuses ?? []).filter((s) => s && s !== "not-applicable");
  if (filtered.length === 0) return "passed";
  return filtered.reduce((acc, s) => (GATE_RANK[s] > GATE_RANK[acc] ? s : acc), "passed");
}

/* -------------------------------------------------------------------------- */
/* Semantiske validatorer                                                     */
/* -------------------------------------------------------------------------- */

export function pilotProfileProblems(set, { deploymentProfiles = [] } = {}) {
  const problems = [];
  if (!set || typeof set !== "object") return [err("/", "profil-sættet er ikke et objekt")];
  const profiles = set.profiles ?? [];
  if (profiles.length !== 3) problems.push(err("/profiles", `der skal være præcis tre virksomhedsprofiler, fandt ${profiles.length}`));
  const ids = new Set();
  const segments = new Set();
  const deploymentSet = new Set(deploymentProfiles);
  for (const [i, profile] of profiles.entries()) {
    const at = `/profiles/${i}`;
    if (ids.has(profile.id)) problems.push(err(`${at}/id`, `profil-id '${profile.id}' er ikke unikt`));
    ids.add(profile.id);
    segments.add(profile.segment);
    if (!isNamedHuman(profile.owner)) problems.push(err(`${at}/owner`, "profilen mangler en navngivet menneskelig ejer"));
    if (deploymentProfiles.length && !deploymentSet.has(profile.deploymentProfileRef)) {
      problems.push(err(`${at}/deploymentProfileRef`, `den valgte installationsprofil '${profile.deploymentProfileRef}' findes ikke`));
    }
    const tenants = new Set();
    for (const [j, tenant] of (profile.tenantFixtures ?? []).entries()) {
      if (tenants.has(tenant.tenantId)) problems.push(err(`${at}/tenantFixtures/${j}/tenantId`, `tenant-id '${tenant.tenantId}' er ikke unikt i profilen`));
      tenants.add(tenant.tenantId);
      if (tenant.synthetic !== true) problems.push(err(`${at}/tenantFixtures/${j}`, "tenant-fixturen skal være eksplicit syntetisk"));
    }
    const roleIds = new Set();
    for (const [j, role] of (profile.roles ?? []).entries()) {
      if (roleIds.has(role.id)) problems.push(err(`${at}/roles/${j}/id`, `rolle-id '${role.id}' er ikke unikt i profilen`));
      roleIds.add(role.id);
      if (role.kind === "agent" && role.namedHuman) problems.push(err(`${at}/roles/${j}`, "en agentrolle må ikke bære en navngivet menneskelig identitet"));
    }
    const integrationIds = new Set();
    for (const [j, integration] of (profile.integrations ?? []).entries()) {
      if (integrationIds.has(integration.id)) problems.push(err(`${at}/integrations/${j}/id`, `integrations-id '${integration.id}' er ikke unikt i profilen`));
      integrationIds.add(integration.id);
      if (integration.availability === "unavailable" && !integration.reason) problems.push(err(`${at}/integrations/${j}`, "en utilgængelig integration skal have en begrundelse"));
    }
    const workflows = new Set(profile.criticalWorkflows ?? []);
    for (const journey of JOURNEYS) if (!workflows.has(journey)) problems.push(err(`${at}/criticalWorkflows`, `profilen mangler den kritiske arbejdsgang '${journey}'`));
  }
  for (const segment of SEGMENTS) if (!segments.has(segment)) problems.push(err("/profiles", `ingen profil dækker segmentet '${segment}'`));
  return problems;
}

export function pilotScenarioProblems(set, { profiles = [] } = {}) {
  const problems = [];
  if (!set || typeof set !== "object") return [err("/", "scenarie-sættet er ikke et objekt")];
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const ids = new Set();
  const perProfile = new Map();
  for (const [i, scenario] of (set.scenarios ?? []).entries()) {
    const at = `/scenarios/${i}`;
    if (ids.has(scenario.id)) problems.push(err(`${at}/id`, `scenarie-id '${scenario.id}' er ikke unikt`));
    ids.add(scenario.id);
    const profile = byId.get(scenario.profileRef);
    if (!profile) problems.push(err(`${at}/profileRef`, `scenariet peger på den ukendte profil '${scenario.profileRef}'`));
    else if (scenario.deploymentProfileRef !== profile.deploymentProfileRef) {
      problems.push(err(`${at}/deploymentProfileRef`, `scenariet bruger '${scenario.deploymentProfileRef}', men profilen bruger '${profile.deploymentProfileRef}'`));
    }
    if (scenario.runner !== scenario.journey) problems.push(err(`${at}/runner`, `runner '${scenario.runner}' stemmer ikke med rejsen '${scenario.journey}'`));
    if (!isNamedHuman(scenario.owner)) problems.push(err(`${at}/owner`, "scenariet mangler en navngivet menneskelig ejer"));
    const stepIds = new Set();
    for (const [j, step] of (scenario.steps ?? []).entries()) {
      if (stepIds.has(step.id)) problems.push(err(`${at}/steps/${j}/id`, `trin-id '${step.id}' er ikke unikt i scenariet`));
      stepIds.add(step.id);
    }
    if (profile) {
      const list = perProfile.get(profile.id) ?? [];
      list.push(scenario.journey);
      perProfile.set(profile.id, list);
    }
  }
  for (const profile of profiles ?? []) {
    const journeys = new Set(perProfile.get(profile.id) ?? []);
    for (const journey of JOURNEYS) if (!journeys.has(journey)) problems.push(err("/scenarios", `profilen '${profile.id}' mangler scenariet for '${journey}'`));
  }
  return problems;
}

export function readinessPolicyProblems(policy, { registry = [], requirementIds = [] } = {}) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "readiness-politikken er ikke et objekt")];
  const checkIds = new Set(registry.map((c) => c.id));
  const reqIds = new Set(requirementIds);
  const gates = policy.gates ?? [];
  const gateIds = new Set();
  for (const [i, gate] of gates.entries()) {
    const at = `/gates/${i}`;
    if (gateIds.has(gate.id)) problems.push(err(`${at}/id`, `gate-id '${gate.id}' er ikke unikt`));
    gateIds.add(gate.id);
    if (!isNamedHuman(gate.owner)) problems.push(err(`${at}/owner`, `gaten '${gate.id}' mangler en navngivet menneskelig ejer`));
    if (!gate.appliesWhen || Object.keys(gate.appliesWhen).length === 0) problems.push(err(`${at}/appliesWhen`, `gaten '${gate.id}' mangler en anvendelighedsbetingelse`));
    const sources = new Set();
    for (const [j, source] of (gate.evidenceSources ?? []).entries()) {
      if (sources.has(source.kind)) problems.push(err(`${at}/evidenceSources/${j}/kind`, `evidensarten '${source.kind}' er angivet flere gange`));
      sources.add(source.kind);
    }
    for (const [j, check] of (gate.checks ?? []).entries()) {
      if (checkIds.size && !checkIds.has(check)) problems.push(err(`${at}/checks/${j}`, `gaten '${gate.id}' peger på den ukendte check '${check}'`));
    }
    for (const [j, ref] of (gate.requirementRefs ?? []).entries()) {
      if (reqIds.size && !reqIds.has(ref)) problems.push(err(`${at}/requirementRefs/${j}`, `gaten '${gate.id}' peger på det ukendte krav '${ref}'`));
    }
  }
  for (const id of REQUIRED_GATES) if (!gateIds.has(id)) problems.push(err("/gates", `readiness-politikken mangler den krævede gate '${id}'`));
  if (policy.observation?.requiredDays !== 30) problems.push(err("/observation/requiredDays", "observationen skal være på 30 dage"));
  if (!policy.observation?.registryRef) problems.push(err("/observation/registryRef", "observationen mangler en registerreference"));
  if (policy.customerAcceptance?.requireForEveryActiveGate !== true) problems.push(err("/customerAcceptance/requireForEveryActiveGate", "kundcaccept skal kræves for hver aktiv gate"));
  if (!(policy.customerAcceptance?.acceptedByRoles ?? []).length) problems.push(err("/customerAcceptance/acceptedByRoles", "der skal være mindst én accepteret rolle for kundcaccept"));
  return problems;
}

export function observationProblems(observation, { requiredDays = 30, now = Date.parse(REPORT_GENERATED_AT) } = {}) {
  const problems = [];
  if (!observation || typeof observation !== "object") return [err("/", "observationen er ikke et objekt")];
  if (!OBSERVATION_STATUSES.includes(observation.status)) problems.push(err("/status", `ukendt observationsstatus '${observation.status}'`));
  if (observation.requiredDays !== requiredDays) problems.push(err("/requiredDays", `observationen kræver ${observation.requiredDays} dage, forventet ${requiredDays}`));
  if (!Number.isInteger(observation.observedDays) || observation.observedDays < 0) problems.push(err("/observedDays", "observedDays skal være et ikke-negativt heltal"));
  if (observation.status === "complete") {
    if (observation.observedDays < observation.requiredDays) problems.push(err("/status", "en afsluttet observation skal dække alle krævede dage"));
    if (!observation.startedAt || !observation.endedAt) problems.push(err("/endedAt", "en afsluttet observation skal have start- og sluttidspunkt"));
    if (!observation.evidenceRef) problems.push(err("/evidenceRef", "en afsluttet observation skal have et evidensreference"));
    const ended = Date.parse(observation.endedAt);
    if (!Number.isFinite(ended) || ended > now) problems.push(err("/endedAt", "observationens sluttidspunkt skal ligge i fortiden"));
  } else if (observation.observedDays >= observation.requiredDays && observation.status !== "in-progress") {
    problems.push(err("/status", "en observation med nok dage men uden afslutning skal være 'in-progress' eller 'complete'"));
  }
  return problems;
}

export function customerAcceptanceProblems(register, { acceptedByRoles = [], maxAgeDays = 30, now = Date.parse(REPORT_GENERATED_AT) } = {}) {
  const problems = [];
  if (!register || typeof register !== "object") return [err("/", "kundcaccept-registeret er ikke et objekt")];
  const roles = new Set(acceptedByRoles);
  const ids = new Set();
  for (const [i, acceptance] of (register.acceptances ?? []).entries()) {
    const at = `/acceptances/${i}`;
    if (!acceptance.id) problems.push(err(`${at}/id`, "accepten mangler et id"));
    else if (ids.has(acceptance.id)) problems.push(err(`${at}/id`, `accept-id '${acceptance.id}' er ikke unikt`));
    else ids.add(acceptance.id);
    if (!isNamedHuman(acceptance.acceptedBy)) problems.push(err(`${at}/acceptedBy`, "accepten skal være registreret af et navngivet menneske"));
    if (roles.size && !roles.has(acceptance.acceptedBy?.role)) problems.push(err(`${at}/acceptedBy/role`, `rollen '${acceptance.acceptedBy?.role}' må ikke acceptere`));
    const at_ = Date.parse(acceptance.acceptedAt);
    if (!Number.isFinite(at_)) problems.push(err(`${at}/acceptedAt`, "accepten mangler et gyldigt tidspunkt"));
    else if ((now - at_) / 86400000 > maxAgeDays) problems.push(err(`${at}/acceptedAt`, "accepten er ældre end den maksimale alder"));
  }
  return problems;
}

/** Er rapporten internt konsistent? Bruges af check og konformans. */
export function readinessReportProblems(report) {
  const problems = [];
  if (!report || typeof report !== "object") return [err("/", "readiness-rapporten er ikke et objekt")];
  if (!READINESS.includes(report.readiness)) problems.push(err("/readiness", `ukendt readiness-beslutning '${report.readiness}'`));
  const active = (report.gates ?? []).filter((g) => g.applicable && g.mandatory);
  const notPassed = active.filter((g) => g.status !== "passed");
  const expected = notPassed.length === 0 ? "ready" : "not-ready";
  if (report.readiness !== expected) problems.push(err("/readiness", `readiness '${report.readiness}' stemmer ikke med gaterne (forventet '${expected}')`));
  for (const profile of report.profiles ?? []) {
    if (profile.complete !== (profile.workflows ?? []).every((w) => w.status === "passed")) {
      problems.push(err(`/profiles/${profile.profileRef}/complete`, "profilens complete-flag stemmer ikke med arbejdsgangene"));
    }
    if ((profile.workflows ?? []).length !== 6) {
      problems.push(err(`/profiles/${profile.profileRef}/workflows`, "profilen skal have præcis seks arbejdsgange"));
    }
  }
  if ((report.abuse?.violations ?? []).length > 0 && report.readiness === "ready") {
    problems.push(err("/abuse/violations", "en rapport med åbne omgåelser kan ikke være 'ready'"));
  }
  if (report.observation?.status !== "complete" && report.readiness === "ready") {
    problems.push(err("/observation/status", "en uafsluttet observation kan ikke give 'ready'"));
  }
  if (report.customerAcceptance?.accepted !== true && report.readiness === "ready") {
    problems.push(err("/customerAcceptance/accepted", "en manglende kundcaccept kan ikke give 'ready'"));
  }
  return problems;
}

export { exists };
