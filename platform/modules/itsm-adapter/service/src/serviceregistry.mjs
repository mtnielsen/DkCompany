/**
 * DKC-044 — ITSM-domænet.
 *
 * Adapterens kerne er ren og sideeffektfri: den korrelerer alarmer til én
 * incident, regner på kvitteringsfrister og eskalation, foreslår problemer og
 * kendte fejl, filtrerer kundesager og håndhæver at en AI aldrig lukker en
 * major incident eller kombinerer roller. `createItsmService` binder domænet
 * til en GLPI-klient.
 *
 * Principperne er de samme som resten af platformen: default-deny, ejeren er
 * et navngivet menneske, tenanten udledes af principalen, en AI arbejder under
 * præcis én uforanderlig rolle, og en manglende menneskelig kvittering stopper
 * risikofyldt handling.
 */
import {
  SEVERITIES,
  INCIDENT_STATES,
  REQUEST_STATES,
  CHANGE_STATES,
  RECORD_KINDS,
  ITSM_EDITIONS,
  DEFAULT_ITSM_POLICY,
  PROCESS_ROLES,
  FORBIDDEN_AI_ROLES,
} from "./constants.mjs";
import {
  indexCatalog,
  affectedServices,
  ownerForService,
  rotationForService,
  currentOnCall,
  escalationTarget,
  ackDeadlineMinutes,
} from "../../../../service-registry/src/catalog.mjs";

export class ItsmError extends Error {
  constructor(message, code = "itsm_error", status = 400) {
    super(message);
    this.name = "ItsmError";
    this.code = code;
    this.status = status;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SEVERITY_FOR_SIGNAL = { critical: "sev1", warning: "sev2", info: "sev3" };

/** Map en alarm-/sensoralvorlighed til ITSM-alvorlighed. */
export function itsmSeverity(severity) {
  if (SEVERITIES[severity]) return severity;
  return SEVERITY_FOR_SIGNAL[severity] ?? "sev3";
}

/** Flet ITSM-politikken med de restriktive standarder. */
export function normalizePolicy(policy = {}) {
  const base = clone(DEFAULT_ITSM_POLICY);
  return {
    ...base,
    ...policy,
    majorIncident: { ...base.majorIncident, ...(policy.majorIncident ?? {}) },
    problem: { ...base.problem, ...(policy.problem ?? {}) },
    change: { ...base.change, ...(policy.change ?? {}) },
    customer: { ...base.customer, ...(policy.customer ?? {}) },
  };
}

function assertHuman(actor, what) {
  if (actor?.kind !== "human") throw new ItsmError(`${what} kræver et verificeret menneske`, "human_required", 403);
}

function isHuman(actor) {
  return actor?.kind === "human";
}

function namedHuman(actor) {
  return { subject: actor.id, name: actor.name ?? actor.id, role: actor.role ?? "human" };
}

function at(now) {
  return new Date(now()).toISOString();
}

function correlationKeyFor(serviceId, alert) {
  return `${serviceId}:${alert.ruleId ?? alert.id ?? "ukendt"}:${alert.signal ?? "ukendt"}`;
}

/**
 * Korrelér én alarm til præcis én åben incident. Samme alarm-ID giver samme
 * incident (idempotent), og to alarmer med samme korrelationsnøgle lægges på
 * samme incident i stedet for at skabe støj.
 */
export function correlateAlarm({ alert, serviceId, catalog, rotations, incidents = [], tenantId = null, now = () => Date.now() }) {
  if (!alert || !alert.id) throw new ItsmError("alarmen mangler et id", "invalid_alert");
  if (!serviceId) throw new ItsmError("alarmen mangler en tjeneste", "invalid_alert");
  const { byId } = indexCatalog(catalog);
  if (!byId.has(serviceId)) throw new ItsmError(`ukendt tjeneste '${serviceId}'`, "unknown_service", 404);
  const rotation = rotationForService(rotations, serviceId);
  const key = correlationKeyFor(serviceId, alert);
  const entered = {
    alertId: alert.alertId ?? alert.id,
    ruleId: alert.ruleId ?? alert.id,
    signal: alert.signal ?? "unknown",
    correlationKey: key,
    emittedAt: alert.emittedAt ?? at(now),
    summary: alert.summary,
  };

  // Idempotens: er alarmen allerede knyttet til en incident, returnér den.
  for (const record of incidents) {
    if ((record.correlatedAlerts ?? []).some((a) => a.alertId === entered.alertId)) {
      return { incident: record, correlated: true, created: false, reason: "alarmen er allerede korreleret" };
    }
  }
  // Korrelér til en åben incident med samme nøgle.
  const openStates = new Set(["new", "acknowledged", "investigating", "mitigated", "resolved"]);
  for (const record of incidents) {
    if (!openStates.has(record.state)) continue;
    if ((record.correlatedAlerts ?? []).some((a) => a.correlationKey === key)) {
      const merged = { ...record, correlatedAlerts: [...record.correlatedAlerts, entered], updatedAt: at(now) };
      return { incident: merged, correlated: true, created: false, reason: `korreleret til ${record.id}` };
    }
  }

  const severity = itsmSeverity(alert.severity);
  const owner = currentOnCall(rotation) ?? byId.get(serviceId).owner;
  if (!owner || !owner.subject) throw new ItsmError(`tjenesten '${serviceId}' har ingen menneskelig on-call`, "no_oncall", 409);
  const affected = affectedServices(catalog, serviceId);
  const recordKind = SEVERITIES[severity]?.major ? "major_incident" : "incident";
  const record = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ItsmRecord",
    id: `INC-${Date.now().toString(36).toUpperCase()}`,
    recordKind,
    title: alert.summary ?? `Alarm på ${serviceId}`,
    description: `Korreleret fra alarm '${entered.alertId}' (regel '${entered.ruleId}').`,
    severity,
    state: "new",
    tenantId,
    serviceId,
    owner: { subject: owner.subject, name: owner.name, role: owner.role },
    affectedServices: affected,
    correlatedAlerts: [entered],
    ciRelations: (byId.get(serviceId).cis ?? []).map((ci) => ({ ciId: ci.id, kind: ci.kind, relation: ci.relation })),
    links: {
      serviceId,
      incidentIds: [],
      changeIds: [],
      problemId: null,
      knownErrorId: null,
      runbook: byId.get(serviceId).runbook,
      approvalIds: [],
      auditIds: [],
    },
    customerVisible: true,
    humanAck: null,
    aiActions: [],
    validatedBy: null,
    validatedAt: null,
    approvals: [],
    closedBy: null,
    rollbackPlan: null,
    createdAt: at(now),
    updatedAt: at(now),
    resolvedAt: null,
  };
  record.links.incidentIds = [record.id];
  return { incident: record, correlated: false, created: true, reason: "ny incident oprettet" };
}

/** Kvitteringstilstand og næste menneske, hvis fristen er overskredet. */
export function acknowledgementState({ record, catalog, rotations, now = () => Date.now() }) {
  if (!record) throw new ItsmError("incidenten findes ikke", "not_found", 404);
  const rotation = rotationForService(rotations, record.serviceId);
  const deadlineMinutes = ackDeadlineMinutes(catalog, rotation, record.severity);
  if (record.humanAck) {
    return { acknowledged: true, overdue: false, deadlineMinutes, elapsedMinutes: 0, target: null };
  }
  const elapsedMinutes = Math.max(0, Math.floor((now() - Date.parse(record.createdAt)) / 60000));
  return {
    acknowledged: false,
    overdue: elapsedMinutes >= deadlineMinutes,
    deadlineMinutes,
    elapsedMinutes,
    target: escalationTarget(rotation, elapsedMinutes),
  };
}

/** Risikofyldt handling må ikke fortsætte uden menneskelig kvittering. */
export function riskyActionAllowed({ record, catalog, rotations, now = () => Date.now() }) {
  if (!record) return { allowed: false, reason: "incidenten findes ikke" };
  const requiresAck = SEVERITIES[record.severity]?.requiresHumanAck !== false;
  if (!requiresAck) return { allowed: true, reason: "alvorligheden kræver ikke menneskelig kvittering" };
  const state = acknowledgementState({ record, catalog, rotations, now });
  if (state.acknowledged) return { allowed: true, reason: "mennesket har kvitteret" };
  return {
    allowed: false,
    reason: state.overdue
      ? `kvitteringsfristen på ${state.deadlineMinutes} min er overskredet; eskalér til ${state.target?.name ?? "næste menneske"}`
      : `afventer menneskelig kvittering inden ${state.deadlineMinutes} min`,
    escalationTarget: state.target ?? null,
    overdue: state.overdue,
  };
}

/**
 * Find gentagne incidents, der kvalificerer til et problem og en kendt fejl.
 * Et problem oprettes aldrig uden en menneskelig validering.
 */
export function problemCandidate({ incidents = [], threshold = 3, windowDays = 30, now = () => Date.now() }) {
  const windowMs = windowDays * 86400000;
  const groups = new Map();
  for (const record of incidents) {
    if (!["incident", "major_incident"].includes(record.recordKind)) continue;
    if (!["resolved", "closed"].includes(record.state)) continue;
    if (record.links?.problemId) continue;
    const key = (record.correlatedAlerts ?? [])[0]?.correlationKey ?? `${record.serviceId}:${record.title}`;
    if (now() - Date.parse(record.createdAt) > windowMs) continue;
    if (!groups.has(key)) groups.set(key, { key, serviceId: record.serviceId, incidentIds: [], signals: new Set() });
    const group = groups.get(key);
    group.incidentIds.push(record.id);
    for (const alert of record.correlatedAlerts ?? []) group.signals.add(alert.signal);
  }
  const proposals = [];
  for (const group of groups.values()) {
    if (group.incidentIds.length < threshold) continue;
    proposals.push({
      serviceId: group.serviceId,
      correlationKey: group.key,
      incidentIds: group.incidentIds,
      count: group.incidentIds.length,
      signals: [...group.signals],
      knownError: {
        title: `Kendt fejl: gentagne incidents på ${group.serviceId}`,
        rootCause: `Gentagne incidents med korrelationsnøglen '${group.key}'.`,
        workaround: "Følg runbook og eskalér til problembehandling.",
      },
      requiresHumanValidation: true,
    });
  }
  return proposals;
}

/** Et problem/en kendt fejl kræver en navngivet menneskelig validering. */
export function problemProblems({ proposal, threshold = 3 }) {
  const problems = [];
  if (!proposal) return ["problemet mangler"];
  if (!Array.isArray(proposal.incidentIds) || proposal.incidentIds.length < threshold) {
    problems.push(`et problem kræver mindst ${threshold} incidents`);
  }
  if (!proposal.verifiedBy || !proposal.verifiedBy.subject) problems.push("problemet kræver en navngiven menneskelig validering");
  if (proposal.verifiedBy && proposal.verifiedBy.kind && proposal.verifiedBy.kind !== "human") problems.push("kun et menneske må validere et problem");
  if (!proposal.knownError?.rootCause) problems.push("den kendte fejl mangler en rodårsag");
  return problems;
}

/** Kundens view: kun egne sager, kun kundevendte felter. Default-deny. */
export function customerView({ record, policy = {} }) {
  const normalized = normalizePolicy(policy);
  if (!record || record.customerVisible !== true) return null;
  if (!normalized.customer.visibleStatuses.includes(record.state)) return null;
  const view = {
    id: record.id,
    recordKind: record.recordKind,
    title: record.title,
    state: record.state,
    severity: record.severity,
    serviceId: record.serviceId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    resolvedAt: record.resolvedAt,
  };
  if (normalized.customer.exposeOwnerIdentity) view.owner = record.owner;
  return view;
}

export function customerCases({ actor, records = [], policy = {} }) {
  if (!actor?.tenantId) return [];
  const normalized = normalizePolicy(policy);
  return records
    .filter((r) => r.tenantId === actor.tenantId)
    .map((r) => customerView({ record: r, policy: normalized }))
    .filter(Boolean);
}

/**
 * En major incident må ikke lukkes af en AI, og et grønt healthcheck er ikke
 * grundlag nok. Lukning kræver menneskelig kvittering og en navngiven
 * menneskelig godkendelse.
 */
export function majorIncidentCloseProblems({ record, actor, healthcheck = null, approvals = [], policy = {} }) {
  const normalized = normalizePolicy(policy);
  const problems = [];
  if (!record) return ["incidenten findes ikke"];
  if (record.recordKind !== "major_incident") return [];
  if (!normalized.majorIncident.requiresHumanClose) return [];
  if (!isHuman(actor)) problems.push("kun et menneske må lukke en major incident");
  if (normalized.majorIncident.requiresHumanAck && !record.humanAck) problems.push("en major incident kan ikke lukkes uden menneskelig kvittering");
  const humanApprovals = (approvals ?? []).filter((a) => a?.kind !== "agent" && a?.verdict === "approve");
  if (humanApprovals.length === 0) problems.push("lukning kræver en navngiven menneskelig godkendelse");
  if (healthcheck && ["green", "pass", "ok"].includes(String(healthcheck).toLowerCase()) && humanApprovals.length === 0 && !normalized.majorIncident.allowAiCloseOnGreenHealthcheck) {
    problems.push("et grønt healthcheck er ikke grundlag nok til at lukke en major incident");
  }
  return problems;
}

/**
 * En serviceproces må bruge flere agenter, men en agent må aldrig kombinere
 * roller. En AI er aldrig ejer eller godkender.
 */
export function serviceProcessProblems({ process, agents = [] }) {
  const problems = [];
  if (!process || !Array.isArray(process.steps) || process.steps.length === 0) {
    return ["serviceprocessen mangler trin"];
  }
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const rolesByAgent = new Map();
  for (const [i, step] of process.steps.entries()) {
    const where = `/steps/${i}`;
    if (!step.name) problems.push(`${where}: trinnet mangler et navn`);
    if (!PROCESS_ROLES.includes(step.role)) problems.push(`${where}: ukendt rolle '${step.role}'`);
    if (FORBIDDEN_AI_ROLES.includes(step.role)) problems.push(`${where}: rollen '${step.role}' kan ikke tildeles en AI`);
    const agent = agentById.get(step.agentId);
    if (!agent) {
      problems.push(`${where}: ukendt agent '${step.agentId}'`);
      continue;
    }
    if (agent.role !== step.role) problems.push(`${where}: agenten '${agent.id}' har rollen '${agent.role}', ikke '${step.role}'`);
    if (!rolesByAgent.has(agent.id)) rolesByAgent.set(agent.id, new Set());
    rolesByAgent.get(agent.id).add(step.role);
  }
  for (const [agentId, roles] of rolesByAgent) {
    if (roles.size > 1) problems.push(`/agents/${agentId}: agenten kombinerer rollerne ${[...roles].join(", ")}`);
  }
  return problems;
}

/**
 * Et delmodul frigives kun, hvis licens, API og driftsprofil er valideret.
 */
export function assessEditionCombination(combination) {
  if (!combination) throw new ItsmError("kombinationen findes ikke", "unknown_combination", 404);
  const product = combination.product ?? {};
  const blockers = [];
  const licenseOk = (lic) => Boolean(lic?.spdx) && Boolean(lic?.type) && lic.type !== "unknown";
  if (!licenseOk(product.license)) blockers.push("GLPI-licensen er ikke afklaret");
  if (product.api?.protocol !== "rest") blockers.push("GLPI-API'et er ikke det dokumenterede REST-API");
  if (product.api?.incidents !== true) blockers.push("GLPI-API'et dækker ikke incidents");
  if (!product.operations?.backup) blockers.push("GLPI-driftsprofilen mangler backupstrategi");
  if (!product.operations?.rpoMinutes || !product.operations?.rtoMinutes) blockers.push("GLPI-driftsprofilen mangler RPO/RTO");

  const base = licenseOk(product.license) && product.api?.protocol === "rest" && Boolean(product.operations?.backup);
  const submodules = {
    serviceCatalog: { released: base && product.api?.serviceCatalog === true, reason: "kræver licens, REST-API og servicekatalog" },
    incidents: { released: base && product.api?.incidents === true, reason: "kræver licens, REST-API og incident-endpoints" },
    requests: { released: base && product.api?.incidents === true, reason: "kræver licens, REST-API og request-endpoints" },
    problems: { released: base && product.api?.problems === true, reason: "kræver licens, REST-API og problem-endpoints" },
    changes: { released: base && product.api?.changes === true, reason: "kræver licens, REST-API og change-endpoints" },
    cmdb: { released: base && product.api?.cmdb === true, reason: "kræver licens, REST-API og CMDB" },
    knowledge: { released: base && product.api?.knowledge === true, reason: "kræver licens, REST-API og vidensbase" },
    sla: { released: base && product.api?.sla === true, reason: "SLA/OLA kræver Network-editionen" },
  };
  const declared = new Set(combination.releasedSubmodules ?? []);
  for (const [name, sub] of Object.entries(submodules)) {
    sub.declared = declared.has(name);
    if (sub.declared && !sub.released) blockers.push(`delmodulet '${name}' frigives uden valideret licens/API/drift`);
  }
  const anyReleased = Object.values(submodules).some((s) => s.released);
  const allReleased = Object.values(submodules).every((s) => s.released);
  return {
    name: combination.name,
    status: allReleased ? "approved" : anyReleased ? "partial" : "blocked",
    blockers,
    submodules,
  };
}

function newRecord({ recordKind, title, description, severity, serviceId, tenantId, owner, catalog, now }) {
  const service = indexCatalog(catalog).byId.get(serviceId);
  if (!service) throw new ItsmError(`ukendt tjeneste '${serviceId}'`, "unknown_service", 404);
  const id = `${recordKind === "change" ? "CHG" : recordKind === "problem" ? "PRB" : recordKind === "known_error" ? "KNE" : recordKind === "request" ? "REQ" : "INC"}-${Date.now().toString(36).toUpperCase()}`;
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ItsmRecord",
    id,
    recordKind,
    title,
    description: description ?? "",
    severity: itsmSeverity(severity),
    state: recordKind === "change" ? "draft" : "new",
    tenantId,
    serviceId,
    owner: owner ?? service.owner,
    requester: null,
    affectedServices: affectedServices(catalog, serviceId),
    correlatedAlerts: [],
    ciRelations: (service.cis ?? []).map((ci) => ({ ciId: ci.id, kind: ci.kind, relation: ci.relation })),
    links: {
      serviceId,
      incidentIds: [],
      changeIds: [],
      problemId: null,
      knownErrorId: null,
      runbook: service.runbook,
      approvalIds: [],
      auditIds: [],
    },
    customerVisible: true,
    humanAck: null,
    aiActions: [],
    validatedBy: null,
    validatedAt: null,
    approvals: [],
    closedBy: null,
    rollbackPlan: null,
    createdAt: at(now),
    updatedAt: at(now),
    resolvedAt: null,
  };
}

/**
 * Bind domænet til en GLPI-klient. Alle muterende operationer kræver et
 * verificeret menneske (undtagen alarmindtag, hvor observationsagenten må
 * korrelere), og hver afvisning eller gennemført handling auditeres.
 */
export function createItsmService({ client, catalog, rotations, policy = {}, now = () => Date.now(), onAudit = () => {} } = {}) {
  if (!client) throw new ItsmError("createItsmService kræver client", "config");
  if (!catalog) throw new ItsmError("createItsmService kræver et servicekatalog", "config");
  let itsmPolicy = normalizePolicy(policy);
  const { byId } = indexCatalog(catalog);

  function audit(type, entry) {
    onAudit({ type, at: at(now), ...entry });
  }

  async function listIncidents(tenantId) {
    const records = (await client.listRecords({ tenantId })) ?? [];
    return records.filter((r) => r.recordKind === "incident" || r.recordKind === "major_incident");
  }

  async function ingestAlarm({ actor, alert, serviceId, tenantId }) {
    if (!isHuman(actor) && actor?.kind !== "agent") throw new ItsmError("alarmindtag kræver en verificeret agent eller et menneske", "access_denied", 403);
    const incidents = await listIncidents(tenantId);
    const result = correlateAlarm({ alert, serviceId, catalog, rotations, incidents, tenantId, now });
    if (result.created) {
      await client.createRecord(result.incident);
      audit("itsm.incident.created", { actor: actor.id, incidentId: result.incident.id, serviceId, affectedServices: result.incident.affectedServices });
    } else {
      await client.updateRecord(result.incident.id, result.incident);
      audit("itsm.incident.correlated", { actor: actor.id, incidentId: result.incident.id, alertId: alert.alertId ?? alert.id });
    }
    return result;
  }

  async function acknowledgeIncident({ actor, incidentId, tenantId }) {
    assertHuman(actor, "kvittering");
    const record = await client.getRecord(incidentId);
    if (!record || record.tenantId !== tenantId) throw new ItsmError("incidenten findes ikke", "not_found", 404);
    const updated = { ...record, humanAck: { subject: actor.id, name: actor.name ?? actor.id, at: at(now) }, state: record.state === "new" ? "acknowledged" : record.state, updatedAt: at(now) };
    await client.updateRecord(incidentId, updated);
    audit("itsm.incident.acknowledged", { actor: actor.id, incidentId, serviceId: record.serviceId });
    return updated;
  }

  async function escalateIncident({ incidentId, tenantId }) {
    const record = await client.getRecord(incidentId);
    if (!record || record.tenantId !== tenantId) throw new ItsmError("incidenten findes ikke", "not_found", 404);
    const state = acknowledgementState({ record, catalog, rotations, now });
    audit("itsm.incident.escalated", { incidentId, serviceId: record.serviceId, overdue: state.overdue, target: state.target?.subject ?? null });
    return { incidentId, overdue: state.overdue, target: state.target ?? null, deadlineMinutes: state.deadlineMinutes, elapsedMinutes: state.elapsedMinutes };
  }

  async function closeIncident({ actor, incidentId, tenantId, healthcheck = null, approvals = [] }) {
    const record = await client.getRecord(incidentId);
    if (!record || record.tenantId !== tenantId) throw new ItsmError("incidenten findes ikke", "not_found", 404);
    const problems = majorIncidentCloseProblems({ record, actor, healthcheck, approvals, policy: itsmPolicy });
    if (problems.length) {
      audit("itsm.incident.close_denied", { actor: actor.id, incidentId, serviceId: record.serviceId, problems });
      throw new ItsmError(`lukning nægtet: ${problems.join("; ")}`, "close_denied", 409);
    }
    const closedBy = isHuman(actor) ? { subject: actor.id, name: actor.name ?? actor.id, kind: "human" } : { subject: actor.id, name: actor.name ?? actor.id, kind: "agent" };
    const updated = { ...record, state: "closed", closedBy, approvals: [...(record.approvals ?? []), ...approvals], resolvedAt: record.resolvedAt ?? at(now), updatedAt: at(now) };
    await client.updateRecord(incidentId, updated);
    audit("itsm.incident.closed", { actor: actor.id, incidentId, serviceId: record.serviceId, recordKind: record.recordKind });
    return updated;
  }

  async function createRequest({ actor, request, tenantId }) {
    assertHuman(actor, "oprettelse af request");
    const serviceId = request.serviceId ?? request.service;
    const record = newRecord({ recordKind: "request", title: request.title, description: request.description, severity: request.severity, serviceId, tenantId, catalog, now });
    record.requester = { subject: actor.id, name: actor.name ?? actor.id, role: actor.role ?? "requester" };
    record.links.auditIds = [request.auditId ?? record.id];
    await client.createRecord(record);
    audit("itsm.request.created", { actor: actor.id, requestId: record.id, serviceId });
    return record;
  }

  /**
   * Opret et problem og en kendt fejl. Kræver en navngivet menneskelig
   * validering, ellers afvises det.
   */
  async function createProblem({ actor, proposal, tenantId }) {
    assertHuman(actor, "problemvalidering");
    const withValidator = { ...proposal, verifiedBy: { subject: actor.id, name: actor.name ?? actor.id, kind: "human" } };
    const problems = problemProblems({ proposal: withValidator, threshold: itsmPolicy.problem.repeatThreshold });
    if (problems.length) {
      audit("itsm.problem.denied", { actor: actor.id, serviceId: proposal.serviceId, problems });
      throw new ItsmError(`problem nægtet: ${problems.join("; ")}`, "problem_denied", 409);
    }
    const problem = newRecord({ recordKind: "problem", title: proposal.knownError?.title ?? "Problem", description: proposal.knownError?.rootCause ?? "", severity: proposal.severity ?? "sev3", serviceId: proposal.serviceId, tenantId, catalog, now });
    problem.validatedBy = { subject: actor.id, name: actor.name ?? actor.id, role: actor.role ?? "human" };
    problem.validatedAt = at(now);
    problem.links.incidentIds = [...proposal.incidentIds];
    problem.links.problemId = problem.id;
    for (const incidentId of proposal.incidentIds) {
      const incident = await client.getRecord(incidentId);
      if (incident) await client.updateRecord(incidentId, { ...incident, links: { ...incident.links, problemId: problem.id }, updatedAt: at(now) });
    }
    const knownError = newRecord({ recordKind: "known_error", title: proposal.knownError?.title ?? "Kendt fejl", description: proposal.knownError?.rootCause ?? "", severity: problem.severity, serviceId: proposal.serviceId, tenantId, catalog, now });
    knownError.validatedBy = problem.validatedBy;
    knownError.validatedAt = problem.validatedAt;
    knownError.links.problemId = problem.id;
    problem.links.knownErrorId = knownError.id;
    await client.createRecord(problem);
    await client.createRecord(knownError);
    audit("itsm.problem.created", { actor: actor.id, problemId: problem.id, knownErrorId: knownError.id, incidents: proposal.incidentIds.length });
    return { problem, knownError };
  }

  /**
   * Opret et change knyttet til incident, tjeneste, runbook, godkendelse og
   * audit-ID. Et change uden runbook eller menneskelig godkendelse afvises.
   */
  async function createChange({ actor, change, tenantId, approvals = [] }) {
    assertHuman(actor, "change");
    const serviceId = change.serviceId ?? change.service;
    const record = newRecord({ recordKind: "change", title: change.title, description: change.description, severity: change.severity, serviceId, tenantId, catalog, now });
    record.state = "approval";
    record.links.runbook = change.runbook ?? byId.get(serviceId)?.runbook ?? null;
    record.links.incidentIds = Array.isArray(change.incidentIds) ? change.incidentIds : [];
    record.links.approvalIds = approvals.map((a) => a.id ?? a.subject).filter(Boolean);
    record.approvals = approvals.map((a) => ({ subject: a.subject, name: a.name ?? a.subject, verdict: a.verdict ?? "approve", at: a.at ?? at(now), kind: a.kind ?? "human" }));
    record.rollbackPlan = change.rollbackPlan ?? "Følg runbook og rul tilbage via GitOps.";
    if (itsmPolicy.change.requireRunbook && !record.links.runbook) throw new ItsmError("et change kræver en runbook", "change_denied", 409);
    if (itsmPolicy.change.requireApproval && record.approvals.filter((a) => a.kind !== "agent").length === 0) {
      throw new ItsmError("et change kræver en menneskelig godkendelse", "change_denied", 409);
    }
    if (itsmPolicy.change.requireIncidentLink && record.links.incidentIds.length === 0) {
      throw new ItsmError("et change skal knyttes til mindst én incident", "change_denied", 409);
    }
    await client.createRecord(record);
    audit("itsm.change.created", { actor: actor.id, changeId: record.id, serviceId, incidentIds: record.links.incidentIds });
    return record;
  }

  async function listCustomerCases({ actor, tenantId }) {
    const records = (await client.listRecords({ tenantId })) ?? [];
    return customerCases({ actor: { ...actor, tenantId: actor.tenantId ?? tenantId }, records, policy: itsmPolicy });
  }

  function assess(name) {
    return assessEditionCombination(ITSM_EDITIONS[name]);
  }

  return {
    get policy() {
      return itsmPolicy;
    },
    setPolicy(next) {
      itsmPolicy = normalizePolicy(next);
    },
    ingestAlarm,
    acknowledgeIncident,
    escalateIncident,
    closeIncident,
    createRequest,
    createProblem,
    createChange,
    listCustomerCases,
    assess,
  };
}
