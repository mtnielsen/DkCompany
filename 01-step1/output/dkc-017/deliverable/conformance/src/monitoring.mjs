/**
 * DKC-017 — semantiske validatorer for telemetri, sensorer, alarmer og
 * sikkerhedsstatus.
 *
 * Skemaerne håndhæver formen. Denne modul håndhæver de beslutninger skemaet
 * ikke kan udtrykke alene:
 *
 *   - telemetri skal være minimeret, bære en normaliseret tenant og et
 *     pseudonymt emne — en rå e-mail/telefon i emnet afvises,
 *   - sensorer skal have en navngiven ejer, en runbook der findes, en
 *     maksimal alder der er længere end det forventede interval og en
 *     konsistent tenant-scoping,
 *   - alarmregler skal pege på en kendt sensor, have en navngiven ejer, en
 *     stigende eskalation, en runbook og en kendt modtager,
 *   - en notifikation skal være minimeret, have ejer/eskalation/runbook og
 *     ikke bære rå persondata,
 *   - en sikkerhedsstatus må kun være `pass` når alle påkrævede sensorer er
 *     friske og uden fund; `stale`/`missing` tæller ikke som grøn.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

export const SIGNALS = ["metric", "log", "trace"];
const SHA256 = /^[a-f0-9]{64}$/;
const KNOWN_OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq", "ne", "absent", "stale", "not-pass"]);
const SEVERITY = { fail: 5, partial: 4, stale: 3, missing: 2, unknown: 1, pass: 0 };

function err(path, message) {
  return { path, message };
}

function schemaAndSemantic(ajvInstance, schemaId, data, semantic) {
  const instance = ajvInstance ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...semantic(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Sensorer                                                                   */
/* -------------------------------------------------------------------------- */

export function sensorRegistryProblems(registry, { root = null } = {}) {
  const problems = [];
  const sensors = Array.isArray(registry?.sensors) ? registry.sensors : [];
  if (sensors.length === 0) {
    problems.push(err("/sensors", "sensorkataloget skal indeholde mindst én sensor"));
    return problems;
  }
  const ids = new Set();
  for (const [i, s] of sensors.entries()) {
    const at = (suffix) => `/sensors/${i}${suffix}`;
    if (!s.id) problems.push(err(at("/id"), "sensoren mangler et id"));
    if (ids.has(s.id)) problems.push(err(at("/id"), `dubleret sensor-id '${s.id}'`));
    ids.add(s.id);
    if (!isNamedHuman(s.owner)) problems.push(err(at("/owner"), `sensoren '${s.id}' skal have et navngivet menneske som ejer`));
    if (!Number.isFinite(s.expectedIntervalSeconds) || s.expectedIntervalSeconds <= 0) {
      problems.push(err(at("/expectedIntervalSeconds"), `sensoren '${s.id}' skal have et positivt forventet interval`));
    }
    if (!Number.isFinite(s.maxAgeSeconds) || s.maxAgeSeconds <= 0) {
      problems.push(err(at("/maxAgeSeconds"), `sensoren '${s.id}' skal have en positiv maksimal alder`));
    } else if (Number.isFinite(s.expectedIntervalSeconds) && s.maxAgeSeconds < s.expectedIntervalSeconds) {
      problems.push(err(at("/maxAgeSeconds"), `sensoren '${s.id}'s maksimale alder er kortere end dens forventede interval`));
    }
    if (s.tenantScoped === true && s.scope !== "tenant") {
      problems.push(err(at("/tenantScoped"), `sensoren '${s.id}' er tenant-scopet og skal have scope 'tenant'`));
    }
    if (s.tenantScoped === false && s.scope === "tenant") {
      problems.push(err(at("/tenantScoped"), `sensoren '${s.id}' har scope 'tenant' men er ikke tenant-scopet`));
    }
    if (!s.runbook) problems.push(err(at("/runbook"), `sensoren '${s.id}' mangler en runbook`));
    else if (root && !existsSync(join(root, s.runbook))) {
      problems.push(err(at("/runbook"), `sensoren '${s.id}'s runbook '${s.runbook}' findes ikke`));
    }
  }
  return problems;
}

export function validateSensorRegistry(data, ajv, opts) {
  const result = schemaAndSemantic(ajv, SCHEMA_IDS.sensorRegistry, data, (d) => sensorRegistryProblems(d, opts ?? {}));
  return result;
}

/* -------------------------------------------------------------------------- */
/* Alarmregler                                                                */
/* -------------------------------------------------------------------------- */

export function alertRuleSetProblems(data, { root = null, sensorIds = null, recipientIds = null } = {}) {
  const problems = [];
  const rules = Array.isArray(data?.rules) ? data.rules : [];
  if (rules.length === 0) {
    problems.push(err("/rules", "regelsættet skal indeholde mindst én regel"));
    return problems;
  }
  const ids = new Set();
  for (const [i, rule] of rules.entries()) {
    const at = (suffix) => `/rules/${i}${suffix}`;
    if (!rule.id) problems.push(err(at("/id"), "reglen mangler et id"));
    if (ids.has(rule.id)) problems.push(err(at("/id"), `dubleret regel-id '${rule.id}'`));
    ids.add(rule.id);
    if (!isNamedHuman(rule.owner)) problems.push(err(at("/owner"), `reglen '${rule.id}' skal have et navngivet menneske som ejer`));
    if (!KNOWN_OPERATORS.has(rule.condition?.operator)) {
      problems.push(err(at("/condition/operator"), `reglen '${rule.id}' har en ukendt operator '${rule.condition?.operator}'`));
    }
    if (sensorIds && !sensorIds.has(rule.sensor)) {
      problems.push(err(at("/sensor"), `reglen '${rule.id}' peger på den ukendte sensor '${rule.sensor}'`));
    }
    if (!Array.isArray(rule.escalation) || rule.escalation.length === 0) {
      problems.push(err(at("/escalation"), `reglen '${rule.id}' mangler en eskalationsstige`));
    } else {
      let previous = -1;
      for (const [j, step] of rule.escalation.entries()) {
        if (!isNamedHuman(step.to)) problems.push(err(at(`/escalation/${j}/to`), `reglen '${rule.id}'s eskalationstrin ${j} skal være et navngivet menneske`));
        if (!Number.isFinite(step.afterMinutes) || step.afterMinutes < 0) {
          problems.push(err(at(`/escalation/${j}/afterMinutes`), `reglen '${rule.id}'s eskalationstrin ${j} mangler et gyldigt tidsrum`));
        } else if (step.afterMinutes < previous) {
          problems.push(err(at(`/escalation/${j}/afterMinutes`), `reglen '${rule.id}'s eskalationstrin skal være stigende`));
        } else {
          previous = step.afterMinutes;
        }
      }
    }
    if (!rule.runbook) problems.push(err(at("/runbook"), `reglen '${rule.id}' mangler en runbook`));
    else if (root && !existsSync(join(root, rule.runbook))) {
      problems.push(err(at("/runbook"), `reglen '${rule.id}'s runbook '${rule.runbook}' findes ikke`));
    }
    const recipients = Array.isArray(rule.recipients) ? rule.recipients : [];
    if (recipients.length === 0) problems.push(err(at("/recipients"), `reglen '${rule.id}' mangler en modtager`));
    const recipientSet = new Set();
    for (const [j, r] of recipients.entries()) {
      if (!r.id) problems.push(err(at(`/recipients/${j}/id`), `reglen '${rule.id}' har en modtager uden id`));
      if (recipientSet.has(r.id)) problems.push(err(at(`/recipients/${j}/id`), `reglen '${rule.id}' gentager modtageren '${r.id}'`));
      recipientSet.add(r.id);
      if (recipientIds && !recipientIds.has(r.id)) problems.push(err(at(`/recipients/${j}/id`), `reglen '${rule.id}' peger på den ukendte modtager '${r.id}'`));
      if (r.type === "webhook" && !r.urlEnv) problems.push(err(at(`/recipients/${j}/urlEnv`), `reglen '${rule.id}'s webhook-modtager mangler en urlEnv-binding`));
    }
  }
  return problems;
}

export function validateAlertRuleSet(data, ajv, opts) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.alertRuleSet, data, (d) => alertRuleSetProblems(d, opts ?? {}));
}

/* -------------------------------------------------------------------------- */
/* Telemetri                                                                  */
/* -------------------------------------------------------------------------- */

const PII_IN_STRING = /@|\+?\d{8,}/;

export function telemetryRecordProblems(record, { now = Date.now() } = {}) {
  const problems = [];
  if (!record || typeof record !== "object") return [err("/", "telemetri-posten er ikke et objekt")];
  if (record.minimized !== true) problems.push(err("/minimized", "telemetri skal være minimeret"));
  if (!SIGNALS.includes(record.signal)) problems.push(err("/signal", `ukendt signal '${record.signal}'`));
  else if (!record[record.signal] || typeof record[record.signal] !== "object") {
    problems.push(err(`/${record.signal}`, `posten mangler sin '${record.signal}'-blok`));
  }
  if (record.subject?.name && PII_IN_STRING.test(String(record.subject.name))) {
    problems.push(err("/subject/name", "telemetri-emnet ser ud som en rå personidentifikator"));
  }
  if (!SHA256.test(record.personalData?.digest ?? "")) {
    problems.push(err("/personalData/digest", "minimeringen mangler en SHA-256 over de fjernede personfelter"));
  }
  const captured = Date.parse(record.capturedAt);
  const at = typeof now === "string" ? Date.parse(now) : now instanceof Date ? now.getTime() : Number(now);
  if (Number.isFinite(captured) && Number.isFinite(at) && captured > at + 60_000) {
    problems.push(err("/capturedAt", "telemetri dateret i fremtiden afvises"));
  }
  return problems;
}

export function validateTelemetryRecord(data, ajv, opts) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.telemetryRecord, data, (d) => telemetryRecordProblems(d, opts ?? {}));
}

/* -------------------------------------------------------------------------- */
/* Alarmnotifikation                                                          */
/* -------------------------------------------------------------------------- */

export function alertNotificationProblems(notification) {
  const problems = [];
  if (!notification || typeof notification !== "object") return [err("/", "notifikationen er ikke et objekt")];
  if (notification.minimized !== true) problems.push(err("/minimized", "notifikationen skal være minimeret"));
  if (PII_IN_STRING.test(String(notification.summary ?? ""))) {
    problems.push(err("/summary", "notifikationens summary indeholder rå persondata"));
  }
  if (!isNamedHuman(notification.owner)) problems.push(err("/owner", "notifikationen skal have et navngivet menneske som ejer"));
  if (!Array.isArray(notification.escalation) || notification.escalation.length === 0) {
    problems.push(err("/escalation", "notifikationen skal have en eskalationsstige"));
  }
  if (!notification.runbook) problems.push(err("/runbook", "notifikationen mangler en runbook"));
  if (!["delivered", "failed", "not-run"].includes(notification.delivery?.status)) {
    problems.push(err("/delivery/status", `ukendt leveringsstatus '${notification.delivery?.status}'`));
  }
  // Ingen ikke-minimerede personfelter i det observerede payload.
  const personalLeak = findUnminimizedPersonal(notification.observed);
  for (const path of personalLeak) problems.push(err(`/observed${path}`, "persondata må ikke bredes ud i en notifikation"));
  return problems;
}

const PERSONAL_KEY_RE = /^(email|e[-_]?mail|phone|mobile|telefon|name|fornavn|efternavn|fullname|full_name|address|adresse|ssn|cpr|personnummer|personal[_-]?number|subject|subject[_-]?id|user(name)?|kunde|employee|borger|first[_-]?name|last[_-]?name|date[_-]?of[_-]?birth|dob|ip[_-]?address|bank[_-]?account|iban)$/i;

function findUnminimizedPersonal(value, path = "", out = []) {
  if (value === null || typeof value !== "object") return out;
  for (const [key, val] of Object.entries(value)) {
    const child = `${path}/${key}`;
    if (PERSONAL_KEY_RE.test(key) && val !== "[MINIMIZED]") out.push(child);
    else if (typeof val === "object") findUnminimizedPersonal(val, child, out);
  }
  return out;
}

export function validateAlertNotification(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.alertNotification, data, alertNotificationProblems);
}

/* -------------------------------------------------------------------------- */
/* Sikkerhedsstatus                                                           */
/* -------------------------------------------------------------------------- */

export function securityPostureProblems(posture) {
  const problems = [];
  if (!posture || typeof posture !== "object") return [err("/", "sikkerhedsstatussen er ikke et objekt")];
  const sensors = Array.isArray(posture.sensors) ? posture.sensors : [];

  const stale = sensors.filter((s) => s.freshness === "stale").map((s) => s.id);
  const missing = sensors.filter((s) => s.freshness === "missing").map((s) => s.id);
  if (JSON.stringify([...stale].sort()) !== JSON.stringify([...(posture.staleSensorIds ?? [])].sort())) {
    problems.push(err("/staleSensorIds", "listen af forældede sensorer stemmer ikke med sensordata"));
  }
  if (JSON.stringify([...missing].sort()) !== JSON.stringify([...(posture.missingSensorIds ?? [])].sort())) {
    problems.push(err("/missingSensorIds", "listen af manglende sensorer stemmer ikke med sensordata"));
  }

  const computed = sensors.reduce((worst, s) => ((SEVERITY[s.status] ?? 1) > (SEVERITY[worst] ?? 0) ? s.status : worst), "pass");
  if (posture.overall !== computed) {
    problems.push(err("/overall", `overall '${posture.overall}' stemmer ikke med den mest alvorlige sensorstatus '${computed}'`));
  }
  if (posture.overall === "pass" && sensors.some((s) => s.freshness !== "fresh")) {
    problems.push(err("/overall", "en status med forældede eller manglende sensorer må ikke være 'pass'"));
  }
  if (posture.overall === "pass" && sensors.some((s) => s.status !== "pass")) {
    problems.push(err("/overall", "en status med ikke-beståede sensorer må ikke være 'pass'"));
  }
  const findings = posture.findings ?? {};
  const sum = Number(findings.critical ?? 0) + Number(findings.high ?? 0) + Number(findings.medium ?? 0) + Number(findings.low ?? 0);
  if (Number(findings.total) !== sum) {
    problems.push(err("/findings/total", "findings.total stemmer ikke med summen af severiteter"));
  }
  return problems;
}

export function validateSecurityPosture(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.securityPosture, data, securityPostureProblems);
}
