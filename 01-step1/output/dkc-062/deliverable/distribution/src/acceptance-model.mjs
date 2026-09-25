/**
 * DKC-062 — model og beslutningssemantik for installations- og
 * releaseacceptance.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - hver brugerrejse binder en understøttet profil og platform til kørebare
 *     trin med et forventet udfald og en navngivet menneskelig ejer,
 *   - gate-politikken har fælles gates (sikkerhed/privacy/restore/rolle) og
 *     særskilte profilgates (HA/host management/immutable/self-healing), og en
 *     aktiv gate må ikke kunne mangle forudsætningskapabiliteter, checks eller
 *     ejeraccept,
 *   - RACI-registeret har et ansvarligt menneske og en stedfortræder pr.
 *     service, dataklasse og kontrolproces, og
 *   - ejeraccept er en særskilt registreret menneskelig begivenhed: den udledes
 *     aldrig af en grøn check og må ikke være forældet eller bundet til et
 *     andet commit/artefakt.
 *
 * Valideringsfunktionerne returnerer arrays af `{ path, message }`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { KNOWN_DATA_CLASSES } from "../../configuration/src/model.mjs";

export const ACCEPTANCE_SCENARIO_PATH = "distribution/acceptance/scenarios.json";
export const ACCEPTANCE_POLICY_PATH = "distribution/acceptance/gate-policy.json";
export const RACI_PATH = "distribution/acceptance/raci.json";
export const OWNER_ACCEPTANCE_PATH = "distribution/acceptance/owner-acceptance.json";
export const REPORT_PATH = "acceptance/report/acceptance-report.json";
export const REPORT_DOC_PATH = "docs/pilot/acceptance-report.md";
export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

export const GATE_KINDS = ["common", "profile"];
export const JOURNEYS = ["install", "configure", "add-remove", "upgrade", "provider-switch", "escalation", "recovery", "exit"];
export const JOURNEY_ACTION = { install: "install", configure: "configure", "add-remove": "add", upgrade: "upgrade", "provider-switch": "provider-switch", escalation: "escalate", recovery: "recover", exit: "export" };
export const TARGETS = ["local-server", "vps", "ha-cluster", "enterprise-dedicated"];
export const ACCEPTANCE_STATUSES = ["passed", "failed", "not-applicable", "missing", "stale", "wrong-artifact", "unapproved", "not-run"];
export const EVIDENCE_STATUSES = ["passed", "failed", "missing", "stale", "wrong-artifact", "not-run"];

/** Rang: højere tal er værre. 'not-applicable' deltager ikke i worst(). */
const STATUS_RANK = {
  passed: 0,
  "not-applicable": -1,
  "not-run": 1,
  missing: 2,
  stale: 3,
  "wrong-artifact": 4,
  unapproved: 5,
  failed: 6,
};

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadScenarioSet(root) {
  return readJson(root, ACCEPTANCE_SCENARIO_PATH);
}
export function loadGatePolicy(root) {
  return readJson(root, ACCEPTANCE_POLICY_PATH);
}
export function loadRaci(root) {
  return readJson(root, RACI_PATH);
}
export function loadOwnerAcceptance(root) {
  return readJson(root, OWNER_ACCEPTANCE_PATH);
}
export function loadAll(root) {
  return {
    scenarios: loadScenarioSet(root),
    policy: loadGatePolicy(root),
    raci: loadRaci(root),
    ownerAcceptance: loadOwnerAcceptance(root),
  };
}

export function sha256(value) {
  return "sha256:" + createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}
export function acceptanceDigest(value) {
  return sha256(value);
}

function unique(list) {
  return new Set(list).size === list.length;
}

/** Hvilket gate-udfald er det værste? 'not-applicable' ignoreres. */
export function worstStatus(statuses) {
  const filtered = statuses.filter((s) => s && s !== "not-applicable");
  if (filtered.length === 0) return "passed";
  return filtered.reduce((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc), "passed");
}

/** Er en gate aktiv for det konkrete acceptmål? */
export function gateApplies(gate, target) {
  const when = gate?.appliesWhen ?? {};
  if (when.always === true) return true;
  if (when.profileType !== undefined && when.profileType !== target?.profileType) return false;
  if (when.hostManagement !== undefined && when.hostManagement !== Boolean(target?.hostManagement)) return false;
  if (when.immutable !== undefined && when.immutable !== Boolean(target?.immutable)) return false;
  if (when.selfHealing !== undefined && when.selfHealing !== Boolean(target?.selfHealing)) return false;
  return true;
}

/** De scenarier der hører til et acceptmål (samme profil). */
export function scenariosForTarget(set, target) {
  return (set?.scenarios ?? []).filter((s) => s.profileRef === target?.profileRef);
}

/* -------------------------------------------------------------------------- */
/* Semantiske validatorer                                                     */
/* -------------------------------------------------------------------------- */

export function acceptanceScenarioProblems(set, { profiles = [], platforms = [] } = {}) {
  const problems = [];
  if (!isNamedHuman(set?.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "scenariesættet skal have et navngivet menneske som ansvarlig"));
  const profileRefs = new Set(profiles.map((p) => p.metadata?.name));
  const platformIds = new Set(platforms.map((p) => p.id));
  const ids = (set?.scenarios ?? []).map((s) => s.id);
  if (!unique(ids)) problems.push(err("/scenarios", "scenarie-id'er skal være unikke"));
  for (const [i, s] of (set?.scenarios ?? []).entries()) {
    if (!profileRefs.has(s.profileRef)) problems.push(err(`/scenarios/${i}/profileRef`, `den ukendte profil '${s.profileRef}'`));
    const profile = profiles.find((p) => p.metadata?.name === s.profileRef);
    if (profile && !(profile.supportedPlatforms ?? []).includes(s.platformRef)) {
      problems.push(err(`/scenarios/${i}/platformRef`, `platformen '${s.platformRef}' er ikke understøttet af profilen '${s.profileRef}'`));
    }
    if (!platformIds.has(s.platformRef)) problems.push(err(`/scenarios/${i}/platformRef`, `den ukendte platform '${s.platformRef}'`));
    if (!isNamedHuman(s.owner)) problems.push(err(`/scenarios/${i}/owner`, "scenariet skal have en navngivet menneskelig ejer"));
    const stepIds = (s.steps ?? []).map((x) => x.id);
    if (!unique(stepIds)) problems.push(err(`/scenarios/${i}/steps`, "trin-id'er skal være unikke i et scenarie"));
    const hasJourneyAction = (s.steps ?? []).some((x) => x.action === JOURNEY_ACTION[s.journey] || (s.journey === "add-remove" && ["add", "remove"].includes(x.action)));
    if (!hasJourneyAction) problems.push(err(`/scenarios/${i}/steps`, `rejsen '${s.journey}' mangler et trin med den tilsvarende handling`));
    for (const field of ["ha", "hostManagement", "immutable", "selfHealing"]) {
      if (s[field] === true && s.profileRef === "small-vps" && field === "ha") {
        problems.push(err(`/scenarios/${i}/${field}`, "HA kan ikke være aktiveret på single-server-profilen"));
      }
    }
    if (s.ha === true && s.profileRef !== "ha-cluster") problems.push(err(`/scenarios/${i}/ha`, "HA kræver ha-cluster-profilen"));
    if (s.target === "ha-cluster" && s.profileRef !== "ha-cluster") problems.push(err(`/scenarios/${i}/target`, "målet 'ha-cluster' kræver ha-cluster-profilen"));
  }
  return problems;
}

export function acceptancePolicyProblems(policy, { registry = [], components = [] } = {}) {
  const problems = [];
  if (!isNamedHuman(policy?.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "gate-politikken skal have et navngivet menneske som ansvarlig"));
  const checkIds = new Set(registry.map((c) => c.id));
  const componentIds = new Set(components.map((c) => c.id));
  const ids = (policy?.gates ?? []).map((g) => g.id);
  if (!unique(ids)) problems.push(err("/gates", "gate-id'er skal være unikke"));

  const byKind = { common: 0, profile: 0 };
  for (const [i, g] of (policy?.gates ?? []).entries()) {
    if (byKind[g.kind] !== undefined) byKind[g.kind] += 1;
    if (!isNamedHuman(g.owner)) problems.push(err(`/gates/${i}/owner`, "hver gate skal have en navngivet menneskelig ejer"));
    for (const c of g.checks ?? []) {
      if (!checkIds.has(c)) problems.push(err(`/gates/${i}/checks`, `gaten peger på den ukendte check '${c}'`));
    }
    if ((g.requiresCapabilities ?? []).length === 0) problems.push(err(`/gates/${i}/requiresCapabilities`, "en gate skal kræve mindst én forudsætningskapabilitet"));
    for (const cap of g.requiresCapabilities ?? []) {
      if (!componentIds.has(cap)) problems.push(err(`/gates/${i}/requiresCapabilities`, `forudsætningskapabiliteten '${cap}' findes ikke i baseline-registeret`));
    }
    for (const req of g.requirementRefs ?? []) {
      if (!/^REQ-[A-Z0-9-]+$/.test(req)) problems.push(err(`/gates/${i}/requirementRefs`, `ugyldigt krav-id '${req}'`));
    }
  }
  if (!(byKind.common >= 4)) problems.push(err("/gates", "der skal være mindst fire fælles gates (sikkerhed, privacy, restore, rolle)"));
  if (!(byKind.profile >= 4)) problems.push(err("/gates", "der skal være de fire profilgates (HA, host management, immutable, self-healing)"));

  const allJourneys = new Set((policy?.gates ?? []).flatMap((g) => g.journeys ?? []));
  for (const j of JOURNEYS) if (!allJourneys.has(j)) problems.push(err("/gates", `rejsen '${j}' er ikke dækket af nogen gate`));

  if ((policy?.roleSeparation?.rejections ?? []).length < 3) problems.push(err("/roleSeparation/rejections", "rolle-adskillelse skal afvise mindst rotation, alias og subagent"));
  if (policy?.ownerAcceptance?.requireForEveryActiveGate !== true) problems.push(err("/ownerAcceptance/requireForEveryActiveGate", "hver aktiv gate skal kræve en registreret ejeraccept"));
  if ((policy?.ownerAcceptance?.acceptedByRoles ?? []).length === 0) problems.push(err("/ownerAcceptance/acceptedByRoles", "ejeraccept skal være knyttet til navngivne roller"));
  return problems;
}

export function raciProblems(raci, { services = [], dataClasses = KNOWN_DATA_CLASSES, controlProcesses = [] } = {}) {
  const problems = [];
  const ids = (raci?.entries ?? []).map((e) => e.id);
  if (!unique(ids)) problems.push(err("/entries", "RACI-id'er skal være unikke"));
  const scopeRefs = { service: new Set(), "data-class": new Set(), "control-process": new Set() };
  for (const [i, e] of (raci?.entries ?? []).entries()) {
    if (!scopeRefs[e.scope]) problems.push(err(`/entries/${i}/scope`, `ukendt scope '${e.scope}'`));
    else scopeRefs[e.scope].add(e.ref);
    for (const role of ["responsible", "substitute", "accountable"]) {
      if (!isNamedHuman(e[role])) problems.push(err(`/entries/${i}/${role}`, `RACI-rollen '${role}' skal være et navngivet menneske`));
    }
    if (e.responsible?.subject && e.substitute?.subject && e.responsible.subject === e.substitute.subject) {
      problems.push(err(`/entries/${i}/substitute`, "stedfortræderen må ikke være den samme person som den ansvarlige"));
    }
    if ((e.consulted ?? []).length === 0) problems.push(err(`/entries/${i}/consulted`, "hver post skal have mindst én konsulteret"));
    if ((e.informed ?? []).length === 0) problems.push(err(`/entries/${i}/informed`, "hver post skal have mindst én informeret"));
  }
  for (const [i, e] of (raci?.entries ?? []).entries()) {
    for (const list of ["consulted", "informed"]) {
      for (const [j, person] of (e[list] ?? []).entries()) {
        if (!isNamedHuman({ ...person, role: person.role ?? "RACI" })) problems.push(err(`/entries/${i}/${list}/${j}`, "hver person skal være et navngivet menneske"));
      }
    }
  }
  for (const svc of services) if (!scopeRefs.service.has(svc)) problems.push(err("/entries", `servicen '${svc}' mangler en RACI-post`));
  for (const dc of dataClasses) if (!scopeRefs["data-class"].has(dc)) problems.push(err("/entries", `dataklassen '${dc}' mangler en RACI-post`));
  for (const cp of controlProcesses) if (!scopeRefs["control-process"].has(cp)) problems.push(err("/entries", `kontrolprocessen '${cp}' mangler en RACI-post`));
  return problems;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Validér den registrerede ejeraccept. En accept er kun gyldig når den er
 * knyttet til et navngivet menneske i en tilladt rolle, ikke er fremtidig, ikke
 * er ældre end grænsen, og er bundet til præcis det commit/artefakt der
 * accepteres.
 */
export function ownerAcceptanceProblems(record, { gates = [], acceptedByRoles = [], maxAgeDays = 30, now = Date.now(), targetCommit = null, artifactDigest = null, profileRef = null } = {}) {
  const problems = [];
  const entries = record?.accepted ?? [];
  const ids = entries.map((e) => e.id);
  if (!unique(ids)) problems.push(err("/accepted", "accept-id'er skal være unikke"));
  const gateIds = new Set(gates.map((g) => g.id));
  for (const [i, e] of entries.entries()) {
    if (!gateIds.has(e.gateId)) problems.push(err(`/accepted/${i}/gateId`, `den ukendte gate '${e.gateId}'`));
    if (!isNamedHuman(e.acceptedBy)) problems.push(err(`/accepted/${i}/acceptedBy`, "ejeraccept skal være givet af et navngivet menneske"));
    if (acceptedByRoles.length && !acceptedByRoles.includes(e.acceptedBy?.role)) {
      problems.push(err(`/accepted/${i}/acceptedBy/role`, `rollen '${e.acceptedBy?.role}' må ikke acceptere gaten`));
    }
    const acceptedAt = Date.parse(e.acceptedAt);
    if (!Number.isFinite(acceptedAt)) problems.push(err(`/accepted/${i}/acceptedAt`, "accepten mangler et gyldigt tidspunkt"));
    else {
      if (acceptedAt > now + 60000) problems.push(err(`/accepted/${i}/acceptedAt`, "accepten er dateret i fremtiden"));
      if ((now - acceptedAt) / DAY_MS > maxAgeDays) problems.push(err(`/accepted/${i}/acceptedAt`, `accepten er ældre end ${maxAgeDays} dage`));
    }
    if (targetCommit && e.targetCommit !== targetCommit) problems.push(err(`/accepted/${i}/targetCommit`, "accepten er bundet til et andet commit end målet"));
    if (artifactDigest && e.artifactDigest !== artifactDigest) problems.push(err(`/accepted/${i}/artifactDigest`, "accepten er bundet til et andet artefakt end målet"));
    if (profileRef && e.profileRef && e.profileRef !== profileRef) problems.push(err(`/accepted/${i}/profileRef`, "accepten er bundet til en anden profil end målet"));
    if (!e.evidenceRef) problems.push(err(`/accepted/${i}/evidenceRef`, "accepten skal henvise til det bevis den dækker"));
  }
  return problems;
}

export function acceptanceResultProblems(result) {
  const problems = [];
  const requiredStatuses = ["total", "passed", "failed", "notApplicable", "missing", "stale", "wrongArtifact", "unapproved", "notRun"];
  for (const key of requiredStatuses) if (!Number.isInteger(result?.statuses?.[key])) problems.push(err(`/statuses/${key}`, `statusfeltet '${key}' mangler`));
  const gateIds = (result?.gates ?? []).map((g) => g.id);
  if (!unique(gateIds)) problems.push(err("/gates", "gate-id'er skal være unikke"));
  for (const [i, g] of (result?.gates ?? []).entries()) {
    if (!ACCEPTANCE_STATUSES.includes(g.status)) problems.push(err(`/gates/${i}/status`, `ukendt status '${g.status}'`));
    if (!EVIDENCE_STATUSES.includes(g.evidenceStatus)) problems.push(err(`/gates/${i}/evidenceStatus`, `ukendt evidensstatus '${g.evidenceStatus}'`));
    if (g.applicable === false && g.status !== "not-applicable") problems.push(err(`/gates/${i}/status`, "en ikke-anvendelig gate skal have status 'not-applicable'"));
    if (g.applicable === true && g.status === "not-applicable") problems.push(err(`/gates/${i}/status`, "en anvendelig gate må ikke være 'not-applicable'"));
    if (g.status === "passed" && g.ownerAcceptanceStatus !== "accepted") problems.push(err(`/gates/${i}/status`, "en gate må ikke bestå uden registreret ejeraccept"));
    if (g.status === "passed" && g.evidenceStatus !== "passed") problems.push(err(`/gates/${i}/status`, "en gate må ikke bestå uden gyldigt testbevis"));
  }
  if (result?.decision === "accepted") {
    for (const g of result.gates ?? []) {
      if (g.applicable && g.status !== "passed") problems.push(err("/decision", `'accepted' kræver at alle aktive gates består, men '${g.id}' er '${g.status}'`));
    }
  }
  if (result?.decision === "pending-owner-acceptance" && (result?.ownerAcceptance?.pendingGates ?? []).length === 0) {
    problems.push(err("/decision", "'pending-owner-acceptance' kræver mindst én gate uden ejeraccept"));
  }
  if (result?.roles?.separated === true && (result?.roles?.violations ?? []).length > 0) {
    problems.push(err("/roles", "roller kan ikke være adskilte og samtidig have overtrædelser"));
  }
  return problems;
}

/** Liste over de kontrolprocesser RACI'en skal dække: gate-id'erne. */
export function controlProcessesFor(policy) {
  return (policy?.gates ?? []).map((g) => g.id);
}

/** De services RACI'en skal dække: komponenter med en driftsrolle. */
export function raciServicesFor(root) {
  const dir = join(root, "catalog", "components");
  if (!existsSync(dir)) return [];
  const desired = new Set(["platform-core", "identity-broker", "audit-service", "host-management", "primary-database", "backup-destination", "object-store"]);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".component.json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).metadata?.name)
    .filter((id) => desired.has(id))
    .sort();
}

export function loadComponents(root) {
  const dir = join(root, "catalog", "components");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".component.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}
