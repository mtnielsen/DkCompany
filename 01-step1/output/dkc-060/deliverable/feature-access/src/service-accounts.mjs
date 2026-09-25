/**
 * DKC-060 — servicekonti.
 *
 * En servicekonto er en ikke-interaktiv identitet med præcis én rolle og et
 * eksplicit, afgrænset sæt scopes. Den kan ikke impersonere et menneske, kan
 * ikke bruges som session, og en adgangskode/token til en servicekonto må ikke
 * genbruge et menneskes token. En servicekonto uden scopes eller med `*` er
 * ugyldig.
 */
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { decideAccess, grantsOf } from "./access.mjs";
import { isNamedHuman } from "./profiles.mjs";

export const SERVICE_ACCOUNT_ROLE = "service-account";

const ADMIN_ROLES = new Set(["platform-admin", "admin", "root", "superuser", "super-admin", "dba", "database-admin", "system-admin"]);
const ADMIN_ROLE_RE = /(^|[-_.])(admin|root|superuser|dba)([-_.]|$)/i;

/**
 * Afgør om en principal bærer administrator-/root-credentials. Sådanne må ikke
 * bruges til forretningsforespørgsler mod en datakilde; en bred credential gør
 * forespørgslen umulig at scope og revisere.
 */
export function isAdminCredential(principal) {
  if (!principal) return false;
  if (principal.kind === "admin") return true;
  if (principal.credentialClass && /admin|root|superuser|dba/i.test(String(principal.credentialClass))) return true;
  for (const role of [...(principal.roles ?? []), ...(principal.groups ?? [])]) {
    const value = String(role).toLowerCase();
    if (ADMIN_ROLES.has(value)) return true;
    if (value.startsWith("platform-admin:")) return true;
    if (ADMIN_ROLE_RE.test(value)) return true;
  }
  return false;
}

function err(path, message) {
  return { path, message };
}

export function serviceAccountProblems(account) {
  const problems = [];
  if (!account || typeof account !== "object") return [err("/", "servicekontoen er ikke et objekt")];
  if (!account.id || typeof account.id !== "string") problems.push(err("/id", "servicekontoen mangler et id"));
  const roles = account.roles ?? [];
  if (roles.length !== 1 || roles[0] !== SERVICE_ACCOUNT_ROLE) {
    problems.push(err("/roles", `en servicekonto skal have præcis rollen '${SERVICE_ACCOUNT_ROLE}' og ingen anden rolle`));
  }
  if (account.interactive !== false) problems.push(err("/interactive", "en servicekonto må ikke kunne logge interaktivt ind"));
  if (account.impersonates) problems.push(err("/impersonates", "en servicekonto må ikke impersonere et menneske"));
  if (!isNamedHuman(account.owner)) problems.push(err("/owner", "servicekontoen skal have et navngivet menneske som ejer"));
  try {
    normalizeTenantId(account.tenantId);
  } catch {
    problems.push(err("/tenantId", "servicekontoen mangler en gyldig tenantbinding"));
  }
  const scopes = account.scopes ?? [];
  if (scopes.length === 0) problems.push(err("/scopes", "servicekontoen skal have mindst ét eksplicit scope"));
  for (const scope of scopes) {
    if (scope === "*" || scope === "*:*" || String(scope).endsWith(":*")) problems.push(err("/scopes", `servicekontoen må ikke have det brede scope '${scope}'`));
  }
  return problems;
}

/** Opretter en frossen servicekonto efter reglerne. */
export function createServiceAccount({ id, tenantId, scopes = [], owner, description = null } = {}) {
  const account = Object.freeze({
    id,
    tenantId,
    roles: Object.freeze([SERVICE_ACCOUNT_ROLE]),
    scopes: Object.freeze([...scopes]),
    interactive: false,
    impersonates: null,
    owner,
    description,
  });
  const problems = serviceAccountProblems(account);
  if (problems.length) throw new Error(`ugyldig servicekonto: ${problems.map((p) => p.message).join("; ")}`);
  return account;
}

/** Udled den principal servicekontoen optræder som. Rettighederne er scopes. */
export function principalForServiceAccount(account) {
  const problems = serviceAccountProblems(account);
  if (problems.length) throw new Error(`ugyldig servicekonto: ${problems.map((p) => p.message).join("; ")}`);
  return { id: account.id, tenantId: account.tenantId, roles: [...account.roles], grants: [...account.scopes], kind: "service-account", verified: true };
}

/** Adgang for en servicekonto går gennem den samme default-deny-motor. */
export function serviceAccountAccess({ serviceAccount, ...input } = {}) {
  const problems = serviceAccountProblems(serviceAccount);
  if (problems.length) return { decision: "deny", allowedFields: [], redactedFields: [], deniedFields: input.fields ?? [], reasons: problems.map((p) => p.message) };
  return decideAccess({ ...input, principal: principalForServiceAccount(serviceAccount) });
}

/** En servicekonto må aldrig kunne fortsætte som et menneske. */
export function cannotImpersonate(account, humanPrincipal) {
  if (!account || !humanPrincipal) return true;
  if (account.impersonates) return false;
  if (grantsOf(account).has(`impersonate:${humanPrincipal.id}`)) return false;
  return true;
}
