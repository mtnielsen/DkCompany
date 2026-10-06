/**
 * DKC-060 — beskyttet connector.
 *
 * Den underliggende connector (DKC-056) håndhæver read-only, scope og
 * tenantbinding. Denne guard tilføjer det, der mangler for forretningsbrug:
 *
 *   - administrator-/root-credentials må ikke bruges til forretningsforespørgsler,
 *   - der må ikke sendes rå, vilkårlig SQL — kun en godkendt, parameteriseret
 *     skabelon med navngivne parametre,
 *   - forespørgslen skal køre som en afgrænset tjenestekonto,
 *   - skabelonen skal være tilladt for den funktion der spørger.
 *
 * Guarden er fail-closed: enhver tvivl afvises, før den underliggende connector
 * ser forespørgslen.
 */
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { principalTenant } from "../../identity/src/tenant.mjs";
import { isAdminCredential } from "./service-accounts.mjs";

export { isAdminCredential };

function err(path, message) {
  return { path, message };
}

export function connectorGuardProblems({ templates = [], allowedTemplateIds = [] } = {}) {
  const problems = [];
  if (!Array.isArray(templates) || templates.length === 0) problems.push(err("/templates", "guarden kræver mindst én godkendt skabelon"));
  const ids = new Set();
  for (const [i, template] of (templates ?? []).entries()) {
    if (!template?.id) problems.push(err(`/templates/${i}/id`, "skabelonen mangler et id"));
    if (ids.has(template?.id)) problems.push(err(`/templates/${i}/id`, `skabelonen '${template?.id}' er angivet flere gange`));
    ids.add(template?.id);
    if (!(template?.sql ?? "").trim()) problems.push(err(`/templates/${i}/sql`, `skabelonen '${template?.id}' mangler SQL`));
    if (!Array.isArray(template?.parameters)) problems.push(err(`/templates/${i}/parameters`, `skabelonen '${template?.id}' skal erklære sine parametre`));
  }
  for (const id of allowedTemplateIds ?? []) {
    if (!ids.has(id)) problems.push(err("/allowedTemplateIds", `den tilladte skabelon '${id}' findes ikke`));
  }
  return problems;
}

/** Binder navngivne parametre i den rækkefølge skabelonen erklærer dem. */
export function bindParams(template, params = {}) {
  const declared = template?.parameters ?? [];
  const names = new Set(declared.map((p) => p.name));
  for (const key of Object.keys(params)) {
    if (!names.has(key)) throw new AuthorizationError(`parameteren '${key}' er ikke erklæret i skabelonen '${template.id}'`);
  }
  return declared.map((parameter) => {
    const value = params[parameter.name];
    if (value === undefined && parameter.required) throw new AuthorizationError(`parameteren '${parameter.name}' mangler for skabelonen '${template.id}'`);
    return value ?? null;
  });
}

/**
 * @param connector  den underliggende DKC-056-connector (har `query(principal, sql, params)`)
 * @param templates  godkendte, parameteriserede skabeloner
 * @param allowedTemplateIds  skabeloner tilladt for denne funktion (default: alle)
 */
export function createGuardedConnector({ connector, templates = [], allowedTemplateIds = null, requireServiceAccount = true } = {}) {
  if (!connector) throw new Error("createGuardedConnector kræver en connector");
  const byId = new Map(templates.map((template) => [template.id, template]));
  const allowed = new Set(allowedTemplateIds ?? templates.map((template) => template.id));
  const events = [];

  return {
    templates: [...byId.keys()],

    async query(principal, request) {
      const tenant = principalTenant(principal);
      const record = (operation, allowedFlag, extra = {}) => events.push({ at: new Date().toISOString(), tenant, principal: principal?.id ?? null, operation, allowed: allowedFlag, ...extra });
      if (!tenant) {
        record("denied", false, { reason: "principal uden tenantbinding" });
        throw new AuthorizationError("connectoren kræver en principal med tenantbinding");
      }
      if (typeof request === "string") {
        record("denied", false, { reason: "rå SQL" });
        throw new AuthorizationError("rå SQL er ikke tilladt gennem den beskyttede connector; brug en godkendt skabelon");
      }
      if (isAdminCredential(principal)) {
        record("denied", false, { reason: "administratorcredentials" });
        throw new AuthorizationError("administratorcredentials må ikke bruges til forretningsforespørgsler");
      }
      if (requireServiceAccount && !(principal?.roles ?? []).includes("service-account")) {
        record("denied", false, { reason: "ikke en afgrænset tjenestekonto" });
        throw new AuthorizationError("connectoren kræver en afgrænset tjenestekonto, ikke en bred eller interaktiv identitet");
      }
      const template = byId.get(request?.templateId);
      if (!template || !allowed.has(template.id)) {
        record("denied", false, { reason: `skabelon '${request?.templateId}'`, templateId: request?.templateId ?? null });
        throw new AuthorizationError(`skabelonen '${request?.templateId ?? "?"}' er ikke godkendt for denne funktion`);
      }
      let params;
      try {
        params = bindParams(template, request.params ?? {});
      } catch (error) {
        record("denied", false, { reason: error.message, templateId: template.id });
        throw error;
      }
      const result = await connector.query(principal, template.sql, params);
      record("query", true, { templateId: template.id, rows: result?.rowCount ?? null });
      return result;
    },

    auditTrail() {
      return events.map((e) => ({ ...e }));
    },
  };
}
