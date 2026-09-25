/**
 * DKC-010 — scope-binding af rettigheder.
 *
 * Et credential er ikke en generel adgangsbillet. Det bindes til:
 *
 *   - **kunde** (`tenantId`),
 *   - **ressource** (det præcise mål; børn er dækket),
 *   - **verbum**,
 *   - **miljø**,
 *   - **audience** — den tilsigtede executor-tjeneste,
 *   - **TTL**.
 *
 * Bindingskontrollen er default-deny: et felt der ikke matcher betyder afvisning.
 * A4-beskyttede ressourcer (policy, audit, nøgler, rettigheder) må aldrig udstedes
 * til en agent.
 */
import { isProtectedResource, normalizeResource } from "../../runtime/src/classification.mjs";
import { roleAllowsVerb } from "../../agent-registry/src/roles.mjs";

export class ScopeError extends Error {
  constructor(message, code = "SCOPE_ERROR") {
    super(message);
    this.name = "ScopeError";
    this.code = code;
  }
}

export const AUDIENCE_PREFIX = "module:";

/** Udled den tilsigtede executor-audience for en handling. */
export function deriveAudience({ capability = null, action = null } = {}) {
  if (capability?.executor) return capability.executor;
  if (action?.audience) return action.audience;
  const root = normalizeResource(action?.target ?? "").split("/")[0];
  if (!root) throw new ScopeError("kan ikke udlede audience uden et target", "audience_required");
  return `${AUDIENCE_PREFIX}${root}`;
}

/** Må der overhovedet udstedes et credential for denne kombination? */
export function assertIssuableScope({ role, verb, resource, tenantId, environment, audience } = {}) {
  const problems = [];
  if (!roleAllowsVerb(role, verb)) problems.push(`rollen '${role}' må ikke udstede rettighed til '${verb}'`);
  if (!tenantId || typeof tenantId !== "string") problems.push("credential skal være bundet til en kunde (tenantId)");
  if (!audience || typeof audience !== "string") problems.push("credential skal være bundet til en audience (executor)");
  if (!environment) problems.push("credential skal være bundet til et miljø");
  if (!resource || typeof resource !== "string") problems.push("credential skal være bundet til en ressource");
  if (isProtectedResource(resource)) problems.push(`ressourcen '${resource}' er A4-beskyttet og må ikke udstedes til en agent`);
  if (problems.length) throw new ScopeError(problems.join("; "), "unissuable_scope");
  return true;
}

/** Er `request` dækket af `scope`? Ensrettet: barn ja, forælder nej. */
export function resourceWithin(request, scope) {
  const t = normalizeResource(request);
  const s = normalizeResource(scope);
  if (!s || !t) return false;
  if (t === s) return true;
  return t.startsWith(s + "/");
}

/**
 * Kontrollér at et udstedt scope dækker den handling der forsøges udført. Alle
 * angivne felter skal matche; udeladte felter kontrolleres ikke (bruges når
 * receiveren kun kender nogle af felterne).
 */
export function scopeAllows(scope = {}, request = {}) {
  const problems = [];
  if (request.verb !== undefined && request.verb !== scope.verb) problems.push(`verbet '${request.verb}' er uden for credentialets scope '${scope.verb}'`);
  if (request.resource !== undefined && !resourceWithin(request.resource, scope.resource)) problems.push(`ressourcen '${request.resource}' er uden for credentialets scope '${scope.resource}'`);
  if (request.environment !== undefined && request.environment !== scope.environment) problems.push(`miljøet '${request.environment}' matcher ikke credentialets '${scope.environment}'`);
  if (request.tenantId !== undefined && String(request.tenantId) !== String(scope.tenantId)) problems.push(`kunden '${request.tenantId}' matcher ikke credentialets '${scope.tenantId}'`);
  if (request.audience !== undefined && request.audience !== scope.audience) problems.push(`audiencen '${request.audience}' matcher ikke credentialets '${scope.audience}'`);
  return { ok: problems.length === 0, problems };
}
