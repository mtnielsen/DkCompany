/**
 * DKC-006 — fælles tenant-kontekst og ressource-ID-kontrakt.
 *
 * Grundreglen: **tenant udledes af den verificerede kontekst** (den signerede
 * principal eller sessionen), aldrig af et felt klienten selv kan sætte. Et
 * `tenantId` i URL, header eller body er en *påstand*; den må kun stemme med
 * den udledte tenant, ellers afvises requesten.
 *
 * Modulet er den ene kilde til:
 *   - kanonisk tenant-normalisering
 *   - den fælles ressource-ID (tenant, type, lokal id) så identiske lokale
 *     id'er hos to kunder ikke kolliderer
 *   - krydskunde-adgang: særskilt rolle + eksplicit scope
 *   - en streng `resolveTenantContext`, som API-grænserne kalder
 */
import { AuthorizationError } from "./errors.mjs";

/** Den rolle der kræves for at handle på tværs af kunder. */
export const PLATFORM_ADMIN_ROLE = "platform-admin";

/** Roller med formen `platform-admin:<tenant>` eller `platform-admin:*` bærer scoped. */
export const PLATFORM_SCOPE_PREFIX = `${PLATFORM_ADMIN_ROLE}:`;

/** Headere en klient aldrig må bruge til at påstå en tenant. */
export const TENANT_HEADERS = [
  "x-tenant-id",
  "x-tenant",
  "tenant-id",
  "x-customer-id",
  "x-customer",
  "x-organization-id",
  "x-org-id",
];

/** Body-/query-felter der er påstande om tenant, ikke autoritet. */
export const TENANT_BODY_FIELDS = ["tenantId", "tenant_id", "customerId", "customer_id", "organizationId", "orgId"];

const TENANT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const RESOURCE_TYPE_RE = /^[a-z][a-z0-9._-]{1,63}$/;

/** Fjern klientleverede tenant-headere før nogen må læse dem. */
export function stripTenantHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!TENANT_HEADERS.includes(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/** Kanonisk tenant-id: trimmet, små bogstaver og et begrænset alfabet. */
export function normalizeTenantId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AuthorizationError("tenant-id mangler eller er ikke en streng", { status: 403, code: "tenant_invalid" });
  }
  const canonical = value.trim().toLowerCase();
  if (!TENANT_ID_RE.test(canonical)) {
    throw new AuthorizationError(`ugyldig tenant-id '${value}'`, { status: 403, code: "tenant_invalid" });
  }
  return canonical;
}

/** Den tenant den verificerede principal er bundet til (kan være null for rene tjenesteidentiteter). */
export function principalTenant(principal) {
  if (!principal || principal.tenantId === undefined || principal.tenantId === null || principal.tenantId === "") return null;
  return normalizeTenantId(principal.tenantId);
}

function roleSet(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])]);
}

/**
 * Udled den eksplicitte krydskunde-scope fra den verificerede principal.
 * Både rollen `platform-admin` og en eksplicit scope kræves; en bar rolle uden
 * scope giver ingen adgang. Scope kommer fra rollen `platform-admin:<tenant>`
 * (eller `platform-admin:*`) og/eller et signeret `tenantScope`-felt.
 */
export function crossTenantScope(principal, { role = PLATFORM_ADMIN_ROLE } = {}) {
  const roles = roleSet(principal);
  const prefix = `${role}:`;
  let platform = roles.has(role);
  const scopes = new Set();
  for (const r of roles) {
    if (typeof r === "string" && r.startsWith(prefix)) {
      platform = true;
      const value = r.slice(prefix.length);
      if (value === "*") scopes.add("*");
      else if (value) scopes.add(normalizeTenantId(value));
    }
  }
  const declared = principal?.tenantScope;
  if (declared === "*") scopes.add("*");
  else if (Array.isArray(declared)) for (const t of declared) scopes.add(t === "*" ? "*" : normalizeTenantId(t));
  else if (typeof declared === "string" && declared) scopes.add(normalizeTenantId(declared));

  const scope = [...scopes];
  return { platform, allowed: platform && scope.length > 0, scope };
}

/**
 * Afgør om principalen må handle for `tenantId`. Egen kunde er altid tilladt;
 * en anden kunde kræver platformrollen og en eksplicit scope der dækker målet.
 */
export function authorizeTenantAccess({ principal, tenantId, role = PLATFORM_ADMIN_ROLE } = {}) {
  const target = normalizeTenantId(tenantId);
  const own = principalTenant(principal);
  if (own && own === target) return { allowed: true, crossTenant: false, own, reason: null };
  const { allowed, scope } = crossTenantScope(principal, { role });
  if (allowed && (scope.includes("*") || scope.includes(target))) {
    return { allowed: true, crossTenant: true, own, reason: null };
  }
  const reason = own
    ? `principalen tilhører kunden '${own}', ikke '${target}'`
    : `principalen mangler tenantbinding og en eksplicit scope for '${target}'`;
  return { allowed: false, crossTenant: false, own, reason };
}

/** Kaster hvis principalen ikke må handle for tenanten. */
export function assertTenantAccess(options) {
  const result = authorizeTenantAccess(options);
  if (!result.allowed) throw new AuthorizationError(result.reason, { status: 403, code: "tenant_forbidden" });
  return result;
}

/* -------------------------------------------------------------------------- */
/* Ressource-ID-kontrakt                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Kanonisk ressource-ID: `res://<tenant>/<type>/<lokal-id>`.
 * Den bærer tenanten, så to kunder med samme lokale id aldrig kolliderer, og
 * en ressource kan ikke læses under en fremmed tenant uden at det opdages.
 */
export function formatResourceId({ tenantId, type, localId } = {}) {
  const tenant = normalizeTenantId(tenantId);
  if (typeof type !== "string" || !RESOURCE_TYPE_RE.test(type)) {
    throw new AuthorizationError(`ugyldig ressourcetype '${type}'`, { status: 400, code: "resource_invalid" });
  }
  if (localId === undefined || localId === null || String(localId) === "") {
    throw new AuthorizationError("lokal ressource-id mangler", { status: 400, code: "resource_invalid" });
  }
  const local = String(localId);
  if (local.includes("/") || local.includes("\\") || local.includes("..") || local.includes("\u0000")) {
    throw new AuthorizationError(`lokal ressource-id '${local}' indeholder ulovlige tegn`, { status: 400, code: "resource_invalid" });
  }
  return `res://${tenant}/${type}/${encodeURIComponent(local)}`;
}

const RESOURCE_ID_RE = /^res:\/\/([a-z0-9][a-z0-9-]{1,62})\/([a-z][a-z0-9._-]{1,63})\/(.+)$/;

export function isResourceId(value) {
  return typeof value === "string" && RESOURCE_ID_RE.test(value);
}

export function parseResourceId(value) {
  const match = RESOURCE_ID_RE.exec(String(value ?? ""));
  if (!match) throw new AuthorizationError(`ugyldig ressource-ID '${value}' (forventer res://<tenant>/<type>/<lokal-id>)`, { status: 400, code: "resource_invalid" });
  const [, tenantId, type, encodedLocal] = match;
  let localId;
  try {
    localId = decodeURIComponent(encodedLocal);
  } catch {
    throw new AuthorizationError(`ressource-ID '${value}' har ugyldig encoding`, { status: 400, code: "resource_invalid" });
  }
  if (localId.includes("/") || localId.includes("\\") || localId.includes("..") || localId.includes("\u0000")) {
    throw new AuthorizationError(`ressource-ID '${value}' har ulovlig lokal id`, { status: 400, code: "resource_invalid" });
  }
  return { tenantId: normalizeTenantId(tenantId), type, localId };
}

/**
 * Tjek at en række ressource-ID'er (eller `{tenantId}`-objekter) alle tilhører
 * den forventede tenant. Returnerer de parsede ressourcer.
 */
export function assertResourceTenant(resourceIds, tenantId) {
  const expected = normalizeTenantId(tenantId);
  const list = Array.isArray(resourceIds) ? resourceIds : [resourceIds];
  return list.map((item) => {
    const parsed = typeof item === "string" ? parseResourceId(item) : { tenantId: normalizeTenantId(item?.tenantId), type: item?.type, localId: item?.localId };
    if (parsed.tenantId !== expected) {
      throw new AuthorizationError(`ressourcen '${parsed.type ?? "?"}' tilhører kunden '${parsed.tenantId}', ikke '${expected}'`, { status: 403, code: "tenant_mismatch" });
    }
    return parsed;
  });
}

/* -------------------------------------------------------------------------- */
/* Streng tenant-kontekst til API-grænser                                     */
/* -------------------------------------------------------------------------- */

/**
 * Saml de tenant-påstande en request bærer: klientleverede headere, body-felter
 * og query-parametre. De er påstande — `resolveTenantContext` afgør om de må
 * bruges.
 */
export function collectTenantClaims({ headers = {}, body = {}, query = {} } = {}) {
  const claims = [];
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  for (const h of TENANT_HEADERS) if (lowerHeaders[h] !== undefined) claims.push(lowerHeaders[h]);
  for (const f of TENANT_BODY_FIELDS) if (body?.[f] !== undefined) claims.push(body[f]);
  for (const f of TENANT_BODY_FIELDS) if (query?.[f] !== undefined) claims.push(query[f]);
  return claims;
}

function collectClaims(values) {
  const out = [];
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }
  return [...new Set(out.map(normalizeTenantId))];
}

/**
 * Udled den autoritative tenant-kontekst for en request.
 *
 * Rækkefølge og regler:
 *   1. Principalens tenant er autoritativ.
 *   2. Enhver påstand i body/query/URL/ressource-ID skal stemme med den; ellers
 *      afvises requesten (`tenant_mismatch`).
 *   3. Har principalen ingen tenant, kræves platformrollen og en eksplicit scope
 *      der dækker præcis én påstået tenant.
 */
export function resolveTenantContext({ principal, claimed = [], resourceIds = [], source = "request", role = PLATFORM_ADMIN_ROLE, allowCrossTenant = true } = {}) {
  const own = principalTenant(principal);
  const claims = collectClaims(Array.isArray(claimed) ? claimed : [claimed]);
  const resources = Array.isArray(resourceIds) && resourceIds.length
    ? assertResourceTenant(resourceIds, own ?? resourceTenantHint(resourceIds))
    : [];

  if (own) {
    const foreign = claims.filter((c) => c !== own);
    if (foreign.length) {
      throw new AuthorizationError(`tenant i ${source} ('${foreign[0]}') matcher ikke den verificerede kundekontekst ('${own}')`, { status: 403, code: "tenant_mismatch" });
    }
    return Object.freeze({ tenantId: own, subject: principal?.id ?? null, source, crossTenant: false, scope: [own], resources });
  }

  // Ingen egen tenant: kun en scopet platform-principal må handle for en kunde.
  if (!allowCrossTenant) {
    throw new AuthorizationError("kunne ikke udlede kundekontekst fra den verificerede identitet", { status: 403, code: "tenant_unresolved" });
  }
  const distinct = [...new Set([...claims, ...resources.map((r) => r.tenantId)])];
  if (distinct.length !== 1) {
    throw new AuthorizationError("en tjeneste uden tenantbinding skal angive præcis én eksplicit tenant", { status: 403, code: "tenant_unresolved" });
  }
  const target = distinct[0];
  const scope = crossTenantScope(principal, { role });
  if (!scope.allowed || !(scope.scope.includes("*") || scope.scope.includes(target))) {
    throw new AuthorizationError(`principalen mangler eksplicit scope for '${target}'`, { status: 403, code: "tenant_forbidden" });
  }
  return Object.freeze({ tenantId: target, subject: principal?.id ?? null, source, crossTenant: true, scope: scope.scope, resources });
}

function resourceTenantHint(resourceIds) {
  const first = (Array.isArray(resourceIds) ? resourceIds : [resourceIds])[0];
  if (typeof first === "string") return parseResourceId(first).tenantId;
  if (first?.tenantId) return first.tenantId;
  throw new AuthorizationError("kunne ikke udlede tenant af ressourcen", { status: 403, code: "tenant_unresolved" });
}

/**
 * Bekvemmeligheds-wrapper: kast hvis principalen ikke har adgang til den
 * udledte tenant, ellers returnér konteksten.
 */
export function requireTenantContext(options) {
  const context = resolveTenantContext(options);
  assertTenantAccess({ principal: options.principal, tenantId: context.tenantId, role: options.role });
  return context;
}
