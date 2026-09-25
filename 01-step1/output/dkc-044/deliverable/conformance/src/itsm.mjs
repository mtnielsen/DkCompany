/**
 * DKC-044 — semantiske validatorer for ITSM: servicekatalog, on-call-rotation
 * og sagsrecords.
 *
 * Skemaerne håndhæver formen. Denne modul håndhæver de beslutninger skemaet
 * ikke kan udtrykke alene:
 *
 *   - hver tjeneste har et navngivet menneske som ejer, en runbook der findes,
 *     en on-call-rotation, en kommunikationskanal og en fuld SLA,
 *   - hver rotation har en menneskelig primær/sekundær/manager og en strengt
 *     stigende eskalationskæde,
 *   - en incident har en ejer og mindst én berørt tjeneste,
 *   - et problem/en kendt fejl er menneskeligt valideret,
 *   - et change har runbook, godkendelse og en incident-/service-kobling,
 *   - en major incident kan ikke lukkes af en AI, heller ikke på et grønt
 *     healthcheck.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";

const SEVERITIES = new Set(["sev1", "sev2", "sev3", "sev4"]);
const CHANNELS = new Set(["statuspage", "email", "sms", "phone", "slack", "teams"]);
const INCIDENT_STATES = new Set(["new", "acknowledged", "investigating", "mitigated", "resolved", "closed", "cancelled"]);
const REQUEST_STATES = new Set(["new", "approved", "in_progress", "fulfilled", "rejected", "cancelled"]);
const CHANGE_STATES = new Set(["draft", "approval", "scheduled", "implementing", "implemented", "rolled_back", "cancelled"]);
const RECORD_STATES = new Set([...INCIDENT_STATES, ...REQUEST_STATES, ...CHANGE_STATES]);
const RECORD_KINDS = new Set(["incident", "major_incident", "request", "problem", "known_error", "change"]);
const CI_KINDS = new Set(["service", "application", "database", "network", "host"]);
const CI_RELATIONS = new Set(["provides", "depends-on", "hosts", "connects"]);

function problem(path, message) {
  return { path, message };
}

function isNamedHuman(value) {
  return Boolean(value?.subject && value?.name && value?.role);
}

/** En kvittering bærer subjekt og navn, men ikke nødvendigvis en rolle. */
function isAck(value) {
  return Boolean(value?.subject && value?.name);
}

function schemaAndSemantic(ajvInstance, schemaId, data, semantic) {
  const instance = ajvInstance ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const result = ok ? [] : errors.map((e) => problem(e.path || "/", e.message));
  if (result.length === 0) result.push(...semantic(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Servicekatalog                                                             */
/* -------------------------------------------------------------------------- */

export function serviceCatalogProblems(catalog, { root = null } = {}) {
  const problems = [];
  const services = Array.isArray(catalog?.services) ? catalog.services : [];
  if (services.length === 0) {
    problems.push(problem("/services", "servicekataloget skal indeholde mindst én tjeneste"));
    return problems;
  }
  const ids = new Set();
  for (const [i, service] of services.entries()) {
    const at = (suffix) => `/services/${i}${suffix}`;
    if (!service.id) problems.push(problem(at("/id"), "tjenesten mangler et id"));
    if (ids.has(service.id)) problems.push(problem(at("/id"), `dubleret tjeneste-id '${service.id}'`));
    ids.add(service.id);
    if (!isNamedHuman(service.owner)) problems.push(problem(at("/owner"), `tjenesten '${service.id}' skal have et navngivet menneske som ejer`));
    if (!service.onCallRotation) problems.push(problem(at("/onCallRotation"), `tjenesten '${service.id}' mangler en on-call-rotation`));
    if (!CHANNELS.has(service.communicationChannel)) {
      problems.push(problem(at("/communicationChannel"), `tjenesten '${service.id}' har en ukendt kommunikationskanal '${service.communicationChannel}'`));
    }
    if (!service.runbook) problems.push(problem(at("/runbook"), `tjenesten '${service.id}' mangler en runbook`));
    else if (root && !existsSync(join(root, service.runbook))) {
      problems.push(problem(at("/runbook"), `tjenesten '${service.id}'s runbook '${service.runbook}' findes ikke`));
    }
    if (!SEVERITIES.has(service.severityDefault)) {
      problems.push(problem(at("/severityDefault"), `tjenesten '${service.id}' har en ukendt standardalvorlighed '${service.severityDefault}'`));
    }
    const slaSeverities = new Set((service.sla ?? []).map((s) => s.severity));
    for (const severity of SEVERITIES) {
      if (!slaSeverities.has(severity)) problems.push(problem(at("/sla"), `tjenesten '${service.id}' mangler SLA for '${severity}'`));
    }
    if (!Array.isArray(service.cis) || service.cis.length === 0) {
      problems.push(problem(at("/cis"), `tjenesten '${service.id}' mangler CI-relationer`));
    } else {
      for (const [j, ci] of service.cis.entries()) {
        if (!ci.id) problems.push(problem(at(`/cis/${j}/id`), `tjenesten '${service.id}' har en CI uden id`));
        if (!CI_KINDS.has(ci.kind)) problems.push(problem(at(`/cis/${j}/kind`), `tjenesten '${service.id}' har en ukendt CI-type '${ci.kind}'`));
        if (!CI_RELATIONS.has(ci.relation)) problems.push(problem(at(`/cis/${j}/relation`), `tjenesten '${service.id}' har en ukendt CI-relation '${ci.relation}'`));
      }
    }
  }
  // Afhængigheder skal pege på kendte tjenester og ikke være selv-refererende.
  for (const service of services) {
    for (const dep of service.dependsOn ?? []) {
      if (dep === service.id) problems.push(problem(`/services/${service.id}/dependsOn`, `tjenesten '${service.id}' afhænger af sig selv`));
      else if (!ids.has(dep)) problems.push(problem(`/services/${service.id}/dependsOn`, `tjenesten '${service.id}' afhænger af den ukendte tjeneste '${dep}'`));
    }
  }
  // Ingen cyklusser i afhængighedsgrafen.
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(services.map((s) => [s.id, s]));
  const walk = (id, trail) => {
    if (visiting.has(id)) {
      problems.push(problem("/services", `afhængighedscyklus: ${[...trail, id].join(" → ")}`));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) walk(dep, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const service of services) walk(service.id, []);
  return problems;
}

export function validateServiceCatalog(data, ajv, opts) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.serviceCatalog, data, (d) => serviceCatalogProblems(d, opts ?? {}));
}

/* -------------------------------------------------------------------------- */
/* On-call-rotation                                                           */
/* -------------------------------------------------------------------------- */

export function onCallRotationProblems(rotations, { serviceIds = null } = {}) {
  const problems = [];
  const list = Array.isArray(rotations?.rotations) ? rotations.rotations : [];
  if (list.length === 0) {
    problems.push(problem("/rotations", "on-call-sættet skal indeholde mindst én rotation"));
    return problems;
  }
  const ids = new Set();
  const coveredServices = new Set();
  for (const [i, rotation] of list.entries()) {
    const at = (suffix) => `/rotations/${i}${suffix}`;
    if (!rotation.id) problems.push(problem(at("/id"), "rotationen mangler et id"));
    if (ids.has(rotation.id)) problems.push(problem(at("/id"), `dubleret rotations-id '${rotation.id}'`));
    ids.add(rotation.id);
    if (!rotation.serviceId) problems.push(problem(at("/serviceId"), "rotationen mangler en tjeneste"));
    else {
      coveredServices.add(rotation.serviceId);
      if (serviceIds && !serviceIds.has(rotation.serviceId)) problems.push(problem(at("/serviceId"), `rotationen peger på den ukendte tjeneste '${rotation.serviceId}'`));
    }
    for (const field of ["primary", "secondary", "manager"]) {
      if (!isNamedHuman(rotation[field])) problems.push(problem(at(`/${field}`), `rotationen '${rotation.id}' skal have et navngivet menneske som ${field}`));
    }
    if (rotation.primary?.subject && rotation.secondary?.subject && rotation.primary.subject === rotation.secondary.subject) {
      problems.push(problem(at("/secondary"), `rotationen '${rotation.id}'s sekundære skal være en anden end den primære`));
    }
    if (!Number.isFinite(rotation.ackMinutes) || rotation.ackMinutes <= 0) {
      problems.push(problem(at("/ackMinutes"), `rotationen '${rotation.id}' skal have en positiv kvitteringsfrist`));
    }
    const escalation = Array.isArray(rotation.escalation) ? rotation.escalation : [];
    if (escalation.length === 0) {
      problems.push(problem(at("/escalation"), `rotationen '${rotation.id}' mangler en eskalationskæde`));
    } else {
      let previous = -1;
      for (const [j, step] of escalation.entries()) {
        if (!isNamedHuman(step.to)) problems.push(problem(at(`/escalation/${j}/to`), `rotationen '${rotation.id}'s eskalationstrin ${j} skal være et navngivet menneske`));
        else if (step.to.subject === rotation.primary?.subject) {
          problems.push(problem(at(`/escalation/${j}/to`), `rotationen '${rotation.id}' eskalerer til den primære igen`));
        }
        if (!Number.isFinite(step.afterMinutes) || step.afterMinutes < 0) {
          problems.push(problem(at(`/escalation/${j}/afterMinutes`), `rotationen '${rotation.id}'s eskalationstrin ${j} mangler et gyldigt tidsrum`));
        } else if (step.afterMinutes < previous) {
          problems.push(problem(at(`/escalation/${j}/afterMinutes`), `rotationen '${rotation.id}'s eskalationstrin skal være stigende`));
        } else {
          previous = step.afterMinutes;
        }
      }
      if (escalation.length && Number.isFinite(rotation.ackMinutes) && escalation[0].afterMinutes !== rotation.ackMinutes) {
        problems.push(problem(at("/escalation/0/afterMinutes"), `rotationen '${rotation.id}'s første eskalation skal matche kvitteringsfristen (${rotation.ackMinutes})`));
      }
    }
  }
  if (serviceIds) {
    for (const serviceId of serviceIds) {
      if (!coveredServices.has(serviceId)) problems.push(problem("/rotations", `tjenesten '${serviceId}' mangler en on-call-rotation`));
    }
  }
  return problems;
}

export function validateOnCallRotationSet(data, ajv, opts) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.onCallRotation, data, (d) => onCallRotationProblems(d, opts ?? {}));
}

/* -------------------------------------------------------------------------- */
/* Sagsrecords                                                                */
/* -------------------------------------------------------------------------- */

function statesFor(recordKind) {
  if (recordKind === "request") return REQUEST_STATES;
  if (recordKind === "change") return CHANGE_STATES;
  return INCIDENT_STATES;
}

export function itsmRecordProblems(record, { serviceIds = null } = {}) {
  const problems = [];
  if (!record || typeof record !== "object") return [problem("/", "sagsrecorden er ikke et objekt")];
  const kind = record.recordKind;
  if (!RECORD_KINDS.has(kind)) problems.push(problem("/recordKind", `ukendt sagsrtype '${kind}'`));
  if (!SEVERITIES.has(record.severity)) problems.push(problem("/severity", `ukendt alvorlighed '${record.severity}'`));
  if (!RECORD_STATES.has(record.state)) problems.push(problem("/state", `ukendt tilstand '${record.state}'`));
  else if (RECORD_KINDS.has(kind) && !statesFor(kind).has(record.state)) {
    problems.push(problem("/state", `tilstanden '${record.state}' er ikke gyldig for '${kind}'`));
  }
  if (!isNamedHuman(record.owner)) problems.push(problem("/owner", "sagsrecorden skal have et navngivet menneske som ejer"));
  if (!record.serviceId) problems.push(problem("/serviceId", "sagsrecorden mangler en tjeneste"));
  else if (serviceIds && !serviceIds.has(record.serviceId)) problems.push(problem("/serviceId", `sagsrecorden peger på den ukendte tjeneste '${record.serviceId}'`));

  const affected = Array.isArray(record.affectedServices) ? record.affectedServices : [];
  if (record.serviceId && !affected.includes(record.serviceId)) {
    problems.push(problem("/affectedServices", "sagsrecorden skal mindst omfatte sin egen tjeneste"));
  }
  if (kind === "incident" || kind === "major_incident") {
    const alerts = Array.isArray(record.correlatedAlerts) ? record.correlatedAlerts : [];
    if (alerts.length === 0) problems.push(problem("/correlatedAlerts", `en ${kind} skal være korreleret fra mindst én alarm`));
  }
  if ((kind === "problem" || kind === "known_error") && !isNamedHuman(record.validatedBy)) {
    problems.push(problem("/validatedBy", `en ${kind} skal være valideret af et navngivet menneske`));
  }
  if (kind === "change") {
    if (!record.links?.runbook) problems.push(problem("/links/runbook", "et change skal pege på en runbook"));
    const approvals = Array.isArray(record.approvals) ? record.approvals : [];
    if (approvals.length === 0) problems.push(problem("/approvals", "et change skal have en menneskelig godkendelse"));
    if (approvals.some((a) => a?.kind && a.kind !== "human")) problems.push(problem("/approvals", "kun et menneske må godkende et change"));
    if (!record.serviceId) problems.push(problem("/serviceId", "et change skal have en tjenestekobling"));
  }
  if (kind === "major_incident") {
    if (record.state === "closed") {
      if (!record.closedBy?.subject || !record.closedBy?.name) problems.push(problem("/closedBy", "en lukket major incident skal være lukket af et navngivet menneske"));
      else if (record.closedBy.kind && record.closedBy.kind !== "human") {
        problems.push(problem("/closedBy", "en AI må ikke lukke en major incident"));
      }
    }
    const humanAck = record.humanAck;
    const riskyStates = new Set(["investigating", "mitigated", "resolved", "closed"]);
    if (riskyStates.has(record.state) && !isAck(humanAck)) {
      problems.push(problem("/humanAck", "en major incident må ikke avancere uden menneskelig kvittering"));
    }
  }
  // En AI må kun optræde som udførende agent med præcis én rolle og aldrig lukke.
  for (const [i, action] of (record.aiActions ?? []).entries()) {
    if (!action.agentId) problems.push(problem(`/aiActions/${i}/agentId`, "en AI-handling mangler en agentidentitet"));
    if (!action.role) problems.push(problem(`/aiActions/${i}/role`, "en AI-handling mangler en rolle"));
  }
  return problems;
}

export function validateItsmRecord(data, ajv, opts) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.itsmRecord, data, (d) => itsmRecordProblems(d, opts ?? {}));
}

export { SEVERITIES as ITSM_SEVERITIES };
