/**
 * DKC-066 — autorisation for views, aggregater og dashboard-adaptere.
 *
 * Dashboardets synlighed er ikke udførelsesmyndighed. Modulet:
 *
 *   - udleder principalens kapabiliteter (hvilke views, om den må se globalt
 *     hostdata, om den må aggregere),
 *   - kræver en eksplicit view-scope for hvert view og en scopet platformrolle
 *     for krydskunde-læsning,
 *   - fjerner følsomme felter (løn, CPR, helbred, prompt/completion) for
 *     principaler uden den nødvendige rolle,
 *   - giver kun `read`-kapabiliteter til adaptere og AI-værktøjer.
 */
import { authorizeTenantAccess, principalTenant, PLATFORM_ADMIN_ROLE } from "../../identity/src/tenant.mjs";
import { isPersonalKey } from "../../persistence/src/redact.mjs";

const HR_FIELDS = new Set(["salary", "lon", "løn", "compensation", "bankaccount", "bank_account", "iban", "health", "helbred", "diagnosis", "unionMembership"]);
const AI_FIELDS = new Set(["prompt", "completion", "messages", "rawPrompt", "rawCompletion"]);

export const VIEWS = ["operations", "vulnerabilities", "test-release", "recovery", "ai"];

export const VIEW_POLICIES = {
  operations: { scopes: ["view:operations"], roles: ["operator", "platform-admin", "service-owner"], globalRoles: ["platform-admin"], sensitive: [] },
  vulnerabilities: { scopes: ["view:vulnerabilities"], roles: ["security-officer", "platform-admin"], globalRoles: ["platform-admin"], sensitive: [] },
  "test-release": { scopes: ["view:test-release"], roles: ["operator", "platform-admin", "independent-verifier"], globalRoles: ["platform-admin"], sensitive: [] },
  recovery: { scopes: ["view:recovery"], roles: ["platform-admin"], globalRoles: ["platform-admin"], sensitive: [] },
  ai: { scopes: ["view:ai"], roles: ["ai-owner", "platform-admin"], globalRoles: ["platform-admin"], sensitive: ["ai"] },
};

function roleSet(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])]);
}

function scopeSet(principal) {
  const scope = principal?.viewScope ?? principal?.scopes ?? [];
  return new Set(Array.isArray(scope) ? scope : [scope]);
}

/** Effektive kapabiliteter for en principal. */
export function capabilitiesFor(principal) {
  const roles = roleSet(principal);
  const scopes = scopeSet(principal);
  const views = new Set();
  const globalViews = new Set();
  for (const view of VIEWS) {
    const policy = VIEW_POLICIES[view];
    const hasRole = policy.roles.some((r) => roles.has(r));
    const hasScope = policy.scopes.some((s) => scopes.has(s));
    if (hasRole && hasScope) views.add(view);
    if (hasRole && hasScope && policy.globalRoles.some((r) => roles.has(r))) globalViews.add(view);
  }
  return { views, globalViews, crossTenant: roles.has(PLATFORM_ADMIN_ROLE), roles, scopes, readOnly: true, canExecute: false };
}

/**
 * Afgør om principalen må læse et view for en tenant.
 * Krydskunde kræver en scopet platformrolle; globalt hostdata kræver en
 * `globalRole`.
 */
export function authorizeView({ principal, view, tenantId, global = false, role = PLATFORM_ADMIN_ROLE } = {}) {
  const reasons = [];
  const policy = VIEW_POLICIES[view];
  if (!policy) return { allowed: false, reasons: [`ukendt view '${view}'`], global: false, crossTenant: false };
  const caps = capabilitiesFor(principal);
  if (!caps.views.has(view)) reasons.push(`principalen mangler adgang til view '${view}'`);
  if (global && !caps.globalViews.has(view)) reasons.push(`view '${view}' kræver en rolle med globalt hostdata`);

  let crossTenant = false;
  const own = principalTenant(principal);
  if (tenantId) {
    const decision = authorizeTenantAccess({ principal, tenantId, role });
    if (!decision.allowed) reasons.push(decision.reason);
    crossTenant = decision.crossTenant === true;
  }
  return { allowed: reasons.length === 0, reasons, global: Boolean(global), crossTenant, capabilities: caps };
}

/** Fjern følsomme felter rekursivt. Returnerer en kopi + redaktionsstier. */
export function redactSensitive(value, { view = null, principal = null } = {}) {
  const caps = principal ? capabilitiesFor(principal) : null;
  const allowedHr = caps ? caps.roles.has("hr-owner") || caps.roles.has("platform-admin") : false;
  const redactions = [];
  function walk(node, path) {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}/${i}`));
    const out = {};
    for (const [key, val] of Object.entries(node)) {
      const child = `${path}/${key}`;
      const sensitiveHr = HR_FIELDS.has(key) || (isPersonalKey(key) && !["subject", "subjectId"].includes(key));
      const sensitiveAi = AI_FIELDS.has(key);
      if ((sensitiveHr && !allowedHr) || (sensitiveAi && view === "ai" && !allowedHr)) {
        redactions.push(child);
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = walk(val, child);
    }
    return out;
  }
  return { value: walk(value, ""), redactions };
}

/** Aggregering må kun ske over autoriserede rækker og på et tilladt niveau. */
export function authorizeAggregate({ principal, view, tenantId, granularity = "tenant" } = {}) {
  const decision = authorizeView({ principal, view, tenantId });
  if (!decision.allowed) return decision;
  const caps = capabilitiesFor(principal);
  if (granularity === "host" && !caps.globalViews.has(view)) {
    return { ...decision, allowed: false, reasons: ["aggregering på hostniveau kræver en global view-rolle"] };
  }
  return decision;
}

/** Adaptere og AI-værktøjer får kun læseadgang. */
export function assertReadOnly(capabilities) {
  if (capabilities?.canExecute) throw new Error("en dashboard-adapter må ikke have udførelsesmyndighed");
  if (capabilities && capabilities.readOnly === false) throw new Error("dashboard-adgang skal være read-only");
  return true;
}

/**
 * Tenant-scopet cache. Nøglen indeholder tenanten, og `get` genautoriserer
 * principalen, så et cachehit ikke kan omgå tenantgrænsen.
 */
export function createViewCache({ ttlMs = 30000, clock = () => Date.now() } = {}) {
  const entries = new Map();
  function keyFor({ tenantId, view, params = {} }) {
    return `${tenantId}|${view}|${JSON.stringify(params, Object.keys(params).sort())}`;
  }
  return {
    set({ tenantId, view, params, data, now = clock() }) {
      entries.set(keyFor({ tenantId, view, params }), { data, expiresAt: now + ttlMs, tenantId });
      return true;
    },
    get({ principal, tenantId, view, params, now = clock() }) {
      const decision = authorizeView({ principal, view, tenantId });
      if (!decision.allowed) return { hit: false, allowed: false, reasons: decision.reasons };
      const entry = entries.get(keyFor({ tenantId, view, params }));
      if (!entry || entry.tenantId !== tenantId || entry.expiresAt <= now) return { hit: false, allowed: true };
      return { hit: true, allowed: true, data: entry.data };
    },
    size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * Et AI-værktøj må kun læse det samme autoriserede view, aldrig rå persondata.
 * Værktøjet returnerer derfor kun aggregater og fjerner følsomme felter.
 */
export function createTelemetryAiTool({ readView } = {}) {
  return {
    name: "telemetry.view",
    capabilities: ["read"],
    async invoke({ principal, view, tenantId, params = {} } = {}) {
      const decision = authorizeView({ principal, view, tenantId });
      if (!decision.allowed) return { ok: false, error: "forbidden", reasons: decision.reasons };
      const data = await readView({ principal, view, tenantId, params, via: "ai-tool" });
      const { value, redactions } = redactSensitive({ aggregates: data.aggregates ?? {}, items: data.items ?? [] }, { view, principal });
      return { ok: true, view, tenantId, aggregates: value.aggregates, items: value.items, status: data.status, redactions };
    },
  };
}
