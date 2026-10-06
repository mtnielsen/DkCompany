/**
 * DKC-012 — serverstyret routing efter kunde og dataklasse.
 *
 * Klienten vælger ikke leverandør, modelversion eller budget. Den angiver kun
 * sin agent-identitet, en dataklasse og selve samtalen. Gatewayen slår op i den
 * serverejede routetabel og afgør:
 *
 *   - at routen hører til kundens tenant,
 *   - at routen tillader den angivne dataklasse,
 *   - at der er en godkendt databehandling når klassen er personhenførbar,
 *   - at en klientangivet model/leverandør stemmer med routen (ellers afvises),
 *   - at et klientangivet max-output ikke hæver route'ens loft.
 *
 * En ukendt dataklasse afvises (fail-closed).
 */

export const DATA_CLASSES = ["public", "internal", "confidential", "personal", "special-category"];

/** Dataklasser hvor behandlingen kræver en godkendt databehandleraftale. */
export const PERSONAL_DATA_CLASSES = new Set(["personal", "special-category"]);

/** Standardklasser for en route uden eksplicit `dataClasses`. */
export const DEFAULT_ROUTE_DATA_CLASSES = ["public", "internal", "confidential"];

export class RoutingError extends Error {
  constructor(message, status = 403, code = "route_forbidden") {
    super(message);
    this.name = "RoutingError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeDataClass(value) {
  if (value === undefined || value === null || value === "") return "internal";
  if (typeof value !== "string") throw new RoutingError("dataklassen skal være en streng", 400, "data_class_invalid");
  const canonical = value.trim().toLowerCase();
  if (!DATA_CLASSES.includes(canonical)) {
    throw new RoutingError(`ukendt dataklasse '${value}' — afvist (fail-closed)`, 422, "data_class_unknown");
  }
  return canonical;
}

function routeDataClasses(route) {
  return Array.isArray(route.dataClasses) && route.dataClasses.length ? route.dataClasses : DEFAULT_ROUTE_DATA_CLASSES;
}

function routeAllowsDataClass(route, dataClass) {
  return routeDataClasses(route).includes(dataClass);
}

function isApprovedFor(route, dataClass) {
  if (!PERSONAL_DATA_CLASSES.has(dataClass)) return true;
  return route.approvedDataProcessing === true && Boolean(route.processor);
}

/**
 * Find den serverstyrede route. Rækkefølge: eksplicit routeId (skal findes og
 * være tenantens), ellers første route for agenten der tillader dataklassen.
 */
export function resolveRoute({ routes, tenantId = null, agentRef, dataClass = "internal", routeId = null, model = null, provider = null } = {}) {
  if (!agentRef) throw new RoutingError("manglende agent-identitet", 401, "agent_missing");
  const canonicalClass = normalizeDataClass(dataClass);
  const candidates = (routes ?? []).filter((r) => r.enabled !== false && r.agentRef === agentRef && (r.tenantId == null || r.tenantId === tenantId));

  let route = null;
  if (routeId) {
    route = candidates.find((r) => r.id === routeId) ?? null;
    if (!route) throw new RoutingError(`route '${routeId}' findes ikke for agenten i denne kunde`, 403, "route_not_found");
  } else {
    route = candidates.find((r) => routeAllowsDataClass(r, canonicalClass)) ?? null;
    if (!route) throw new RoutingError(`ingen gateway-route for agent '${agentRef}' — direkte leverandørkald er forbudt`, 403, "route_missing");
  }

  if (!routeAllowsDataClass(route, canonicalClass)) {
    throw new RoutingError(`route '${route.id}' tillader ikke dataklassen '${canonicalClass}'`, 403, "data_class_forbidden");
  }
  if (!isApprovedFor(route, canonicalClass)) {
    throw new RoutingError(`route '${route.id}' har ingen godkendt databehandling for dataklassen '${canonicalClass}'`, 403, "processing_not_approved");
  }
  if (provider && provider !== route.provider) {
    throw new RoutingError(`klienten må ikke vælge leverandør ('${provider}' er ikke route'ens '${route.provider}')`, 403, "provider_forbidden");
  }
  if (model && model !== route.model) {
    throw new RoutingError(`modellen '${model}' matcher ikke route'ens '${route.model}'`, 403, "model_forbidden");
  }

  return {
    route,
    dataClass: canonicalClass,
    personalData: PERSONAL_DATA_CLASSES.has(canonicalClass),
    maxOutputTokens: route.maxOutputTokens ?? null,
    timeoutMs: route.timeoutMs ?? 30000,
    costPerTokenEur: route.costPerTokenEur ?? null,
  };
}

/**
 * Håndhæv route'ens max-output: en klient må gerne bede om mindre, men aldrig
 * hæve loftet. Returnerer det effektive loft.
 */
export function effectiveMaxOutput({ resolved, requestedMaxTokens }) {
  const ceiling = resolved.maxOutputTokens;
  if (requestedMaxTokens == null) return ceiling;
  if (!Number.isInteger(requestedMaxTokens) || requestedMaxTokens <= 0) {
    throw new RoutingError("max_tokens skal være et positivt heltal", 400, "max_output_invalid");
  }
  if (ceiling != null && requestedMaxTokens > ceiling) {
    throw new RoutingError(`max_tokens (${requestedMaxTokens}) må ikke overstige route'ens loft (${ceiling})`, 403, "max_output_forbidden");
  }
  return requestedMaxTokens;
}
