/**
 * DKC-054 — den ene validerings-API.
 *
 * Både den deklarative fil, CLI'et, portalen (UI) og JSON-API'et kalder denne
 * funktion. Det er ikke muligt at gemme en konfiguration gennem én flade, som
 * en anden flade ville afvise: samme schema, samme semantik og samme digest.
 */
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { configurationProblems, normalizeConfiguration, configurationDigest } from "./model.mjs";

/**
 * @param {object} input   Rå konfiguration (fra fil, UI-formular eller API-body).
 * @param {object} opts    source, ajv og kanoniske kilder (loggingPolicy, gatewayRoutes).
 * @returns {{ok:boolean, errors:Array, normalized:object|null, digest:string|null, source:string}}
 */
export function validateConfigurationInput(input, { source = "unknown", ajv = null, ...opts } = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [];
  const schema = validate(instance, SCHEMA_IDS.platformConfiguration, input);
  if (!schema.ok) {
    for (const e of schema.errors) errors.push({ path: e.path, message: e.message, kind: "schema" });
  } else {
    for (const p of configurationProblems(input, opts)) errors.push({ ...p, kind: "semantic" });
  }
  const normalized = errors.length === 0 ? normalizeConfiguration(input) : null;
  return {
    ok: errors.length === 0,
    errors,
    normalized,
    digest: normalized ? configurationDigest(normalized) : null,
    source,
  };
}

/**
 * Valider en indsendelse fra en given kontrolkilde. En `file`-indsendelse og en
 * `portal`-indsendelse med samme indhold giver samme digest og samme effekt.
 */
export function validateSubmission({ source, payload, ...opts }) {
  if (!["file", "portal", "api", "cli"].includes(source)) {
    return { ok: false, errors: [{ path: "/source", message: `ukendt kontrolkilde '${source}'`, kind: "source" }], normalized: null, digest: null, source };
  }
  return validateConfigurationInput(payload, { source, ...opts });
}

export { configurationProblems, normalizeConfiguration, configurationDigest };
