/**
 * DKC-066 — autentificeret læse-API.
 *
 * Læsevejen er tenant-scopet hele vejen: `readView`, `readRecords`, `resolveLink`
 * og `exportView` udleder tenanten af den verificerede principal, genautoriserer
 * ved cachehit og afviser krydskunde uden en scopet platformrolle. Ingen af
 * metoderne ændrer tilstand eller giver udførelsesmyndighed.
 */
import { createHash } from "node:crypto";
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { principalTenant, authorizeTenantAccess, normalizeTenantId } from "../../identity/src/tenant.mjs";
import { authorizeView, redactSensitive, createViewCache } from "./authz.mjs";
import { buildView, VIEW_BUILDERS } from "./views.mjs";
import { parseResourceId } from "../../identity/src/tenant.mjs";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function targetTenant(principal, requested) {
  const own = principalTenant(principal);
  const target = requested ? normalizeTenantId(requested) : own;
  if (!target) throw new AuthorizationError("kunne ikke udlede tenant for forespørgslen", { status: 403, code: "tenant_unresolved" });
  const decision = authorizeTenantAccess({ principal, tenantId: target });
  if (!decision.allowed) throw new AuthorizationError(decision.reason, { status: 403, code: "tenant_forbidden" });
  return { tenantId: target, crossTenant: decision.crossTenant };
}

export function createQueryService({ store, cache = createViewCache(), clock = () => Date.now() } = {}) {
  if (!store) throw new Error("createQueryService kræver et lager");

  function readView({ principal, view, tenantId = null, environment = null, service = null, params = {}, now = clock(), via = "api" } = {}) {
    if (!VIEW_BUILDERS[view]) throw new AuthorizationError(`ukendt view '${view}'`, { status: 400, code: "view_unknown" });
    const { tenantId: target, crossTenant } = targetTenant(principal, tenantId);
    const decision = authorizeView({ principal, view, tenantId: target, global: params.global === true });
    if (!decision.allowed) throw new AuthorizationError(decision.reasons.join("; "), { status: 403, code: "view_forbidden" });

    const cacheParams = { environment, service, windowSeconds: params.windowSeconds ?? null, global: params.global === true };
    const cached = cache.get({ principal, tenantId: target, view, params: cacheParams, now });
    if (cached.hit) return { ...cached.data, cached: true, via };

    const rows = store.query({ tenantId: target, signal: params.signal ?? null, from: params.from ?? null, to: params.to ?? null, limit: params.limit ?? store.stats().capacity }).items;
    const built = buildView(view, { records: rows, tenantId: target, environment, service, now, windowSeconds: params.windowSeconds, maxAgeSeconds: params.maxAgeSeconds });
    // Sidste tenant-spærring: en projection må ikke indeholde fremmede tenanter.
    for (const item of built.items) {
      const owner = item.tenantId ?? (item.resource ? /^res:\/\/([a-z0-9-]+)\//.exec(item.resource)?.[1] : null);
      if (owner && owner !== target && owner !== "platform") {
        throw new Error(`tenant-lækage i view '${view}': ${owner}`);
      }
    }
    const { value, redactions } = redactSensitive(built, { view, principal });
    value.redactions = redactions;
    value.crossTenant = crossTenant;
    cache.set({ tenantId: target, view, params: cacheParams, data: value, now });
    return { ...value, cached: false, via };
  }

  function readRecords({ principal, tenantId = null, signal = null, from = null, to = null, limit = 100, cursor = null } = {}) {
    const { tenantId: target, crossTenant } = targetTenant(principal, tenantId);
    const page = store.query({ tenantId: target, signal, from, to, limit, cursor });
    return { tenantId: target, crossTenant, ...page };
  }

  /** Slå en ressource-/link-reference op — kun hvis tenanten matcher. */
  function resolveLink({ principal, resourceId } = {}) {
    const parsed = parseResourceId(resourceId);
    if (parsed.tenantId !== "platform") {
      const decision = authorizeTenantAccess({ principal, tenantId: parsed.tenantId });
      if (!decision.allowed) throw new AuthorizationError(decision.reason, { status: 403, code: "tenant_forbidden" });
    }
    const record = store.get(parsed.localId) ?? store.query({ tenantId: parsed.tenantId, limit: store.stats().capacity }).items.find((r) => r.resource === resourceId || r.id === parsed.localId) ?? null;
    return { resource: parsed, record };
  }

  /** Eksportér et view. Krydskunde afvises, og eksporten bærer digest + tenant. */
  function exportView({ principal, view, tenantId = null, params = {}, now = clock() } = {}) {
    const data = readView({ principal, view, tenantId, params, now, via: "export" });
    const redactions = redactSensitive(data, { view, principal });
    const content = JSON.stringify({ exportedAt: new Date(now).toISOString(), view, scope: data.scope, status: data.status, aggregates: redactions.value.aggregates, items: redactions.value.items }, null, 2) + "\n";
    return { view, tenantId: data.scope.tenantId, status: data.status, content, sha256: digest(content), redactions: redactions.redactions };
  }

  return { readView, readRecords, resolveLink, exportView, cache, store };
}
