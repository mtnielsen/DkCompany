/**
 * DKC-015 — semantiske validatorer for infrastrukturplanen.
 *
 * JSON Schema håndhæver formen og de binære valg (krypteret storage,
 * default-deny, godkendt break-glass). Denne modul håndhæver de beslutninger,
 * et skema ikke kan udtrykke alene:
 *
 *   - dev, staging og prod findes hver især og har unikke namespaces,
 *   - hver kontroltjeneste (pdp, audit, approvals, gateway, runtime) er med,
 *   - netværksallowlisten er eksplicit og krydser ikke tenants/miljøer,
 *   - intet hemmeligt materiale ligger i klartekst (hverken PEM eller værdier),
 *   - break-glass er bundet til et navngivet menneske, tidsbegrænset og
 *     kræver godkendelse,
 *   - omkostningsposterne summer til det registrerede månedsbeløb.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

const REQUIRED_SERVICES = ["pdp", "audit-service", "approvals", "ai-gateway", "runtime"];
const REQUIRED_ENVIRONMENTS = ["dev", "staging", "prod"];
const SUSPICIOUS_KEY = /^(password|passwd|token|apikey|api_key|privatekey|private_key|clientsecret|client_secret|secretvalue|secret)$/i;

function err(path, message) {
  return { path, message };
}

/** Find klartekst-hemmeligheder: PEM-blokke eller værdier under mistænkelige nøgler. */
export function findInlineSecrets(value, path = "") {
  const findings = [];
  if (typeof value === "string") {
    if (/-----BEGIN [A-Z ]+-----/.test(value)) findings.push(err(path, "indeholder en PEM-blok i klartekst"));
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) findings.push(...findInlineSecrets(item, `${path}/${i}`));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && SUSPICIOUS_KEY.test(key)) {
        findings.push(err(`${path}/${key}`, `en hemmelighed ('${key}') må ikke stå i klartekst`));
      }
      findings.push(...findInlineSecrets(item, `${path}/${key}`));
    }
  }
  return findings;
}

export function environmentNamespaces(data) {
  return new Set((data?.environments ?? []).map((e) => e.namespace));
}

export function infrastructurePlanProblems(data) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "infrastrukturplanen skal have et navngivet menneske som ejer"));
  }
  if (!/^catalog\/profiles\/[a-z0-9-]+\.profile\.json$/.test(data?.hostingProfileRef ?? "")) {
    problems.push(err("/hostingProfileRef", "hostingProfileRef skal pege på en profil i catalog/profiles"));
  }

  const ids = new Set();
  const namespaces = new Set();
  for (const [i, env] of (data?.environments ?? []).entries()) {
    const at = (suffix) => `/environments/${i}${suffix}`;
    if (ids.has(env.id)) problems.push(err(at("/id"), `dubleret miljø-id '${env.id}'`));
    ids.add(env.id);
    if (namespaces.has(env.namespace)) problems.push(err(at("/namespace"), `dubleret namespace '${env.namespace}' på tværs af miljøer`));
    namespaces.add(env.namespace);

    const serviceNames = new Set((env.services ?? []).map((s) => s.name));
    for (const required of REQUIRED_SERVICES) {
      if (!serviceNames.has(required)) problems.push(err(at("/services"), `miljøet '${env.id}' mangler kontroltjenesten '${required}'`));
    }
    for (const allow of env.network?.egressAllow ?? []) {
      if (/^(\*|0\.0\.0\.0\/0|::\/0)$/.test(allow)) problems.push(err(at("/network/egressAllow"), `miljøet '${env.id}' har en wildcard-egress '${allow}'`));
      const foreign = (data.environments ?? []).filter((other) => other.namespace && allow.includes(other.namespace) && other.namespace !== env.namespace);
      if (foreign.length) problems.push(err(at("/network/egressAllow"), `miljøet '${env.id}' tillader egress til et andet miljøs namespace ('${allow}')`));
    }
  }
  for (const required of REQUIRED_ENVIRONMENTS) {
    if (!ids.has(required)) problems.push(err("/environments", `miljøet '${required}' mangler`));
  }

  const breakGlass = data?.bootstrap?.breakGlass;
  if (breakGlass) {
    if (!isNamedHuman(breakGlass.owner)) problems.push(err("/bootstrap/breakGlass/owner", "break-glass skal ejes af et navngivet menneske"));
    if (breakGlass.requiresApproval !== true) problems.push(err("/bootstrap/breakGlass/requiresApproval", "break-glass skal kræve godkendelse"));
    if (!Number.isInteger(breakGlass.maxDurationMinutes) || breakGlass.maxDurationMinutes < 1 || breakGlass.maxDurationMinutes > 240) {
      problems.push(err("/bootstrap/breakGlass/maxDurationMinutes", "break-glass skal være tidsbegrænset til højst 240 minutter"));
    }
    if (!(breakGlass.contact ?? "").trim()) problems.push(err("/bootstrap/breakGlass/contact", "break-glass skal have en kontaktvej"));
  }

  const keyManagement = data?.bootstrap?.keyManagement;
  if (keyManagement && (keyManagement.rotationDays < 1 || keyManagement.rotationDays > 365)) {
    problems.push(err("/bootstrap/keyManagement/rotationDays", "nøglerotation skal ligge mellem 1 og 365 dage"));
  }

  const cost = data?.cost;
  if (cost) {
    const sum = (cost.items ?? []).reduce((acc, item) => acc + (Number(item.monthly) || 0), 0);
    if (Math.abs(sum - Number(cost.monthlyEstimate)) > 0.01) {
      problems.push(err("/cost/monthlyEstimate", `månedsbeløbet (${cost.monthlyEstimate}) matcher ikke summen af posterne (${sum.toFixed(2)})`));
    }
  }

  problems.push(...findInlineSecrets(data));
  return problems;
}

export function validateInfrastructurePlan(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.infrastructurePlan, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...infrastructurePlanProblems(data));
  return { ok: result.length === 0, errors: result };
}
