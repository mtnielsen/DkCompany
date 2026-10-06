/**
 * DKC-060 — gæsteadgang.
 *
 * En gæst er ikke et medlem med færre rettigheder; en gæst er en tidsbegrænset,
 * eksplicit liste af ressourcer og felter. Der findes ingen rollearv, ingen
 * tenantbred adgang og ingen adgang efter udløb. En gæstebevilling skal kunne
 * afvises uden at slå op i selve ressourcen.
 */
import { normalizeTenantId, principalTenant } from "../../identity/src/tenant.mjs";
import { READ_ACTIONS } from "./constants.mjs";
import { isNamedHuman } from "./profiles.mjs";

function err(path, message) {
  return { path, message };
}

export function guestGrantProblems(grant, { now = Date.now() } = {}) {
  const problems = [];
  if (!grant || typeof grant !== "object") return [err("/", "gæstebevillingen er ikke et objekt")];
  if (!grant.subject || typeof grant.subject !== "string") problems.push(err("/subject", "gæstebevillingen mangler et subject"));
  if (!isNamedHuman(grant.invitedBy)) problems.push(err("/invitedBy", "gæstebevillingen skal være udstedt af et navngivet menneske"));
  const expires = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expires)) problems.push(err("/expiresAt", "gæstebevillingen mangler et gyldigt udløbstidspunkt"));
  else if (expires <= now) problems.push(err("/expiresAt", "gæstebevillingen er udløbet"));
  if (!Array.isArray(grant.resources) || grant.resources.length === 0) problems.push(err("/resources", "gæstebevillingen skal pege på mindst én eksplicit ressource"));
  if ((grant.roles ?? []).length > 0) problems.push(err("/roles", "en gæst må ikke arve roller eller grupper"));
  if (grant.tenantWide === true) problems.push(err("/tenantWide", "en gæst må ikke have tenantbred adgang"));
  if (!Array.isArray(grant.fields)) problems.push(err("/fields", "gæstebevillingen skal udtrykke hvilke felter der deles, selv om listen er tom"));
  try {
    normalizeTenantId(grant.tenantId);
  } catch {
    problems.push(err("/tenantId", "gæstebevillingen mangler en gyldig tenantbinding"));
  }
  return problems;
}

export function decideGuestAccess({ guest, grant, resource = {}, field = null, action = "read", now = Date.now() } = {}) {
  const problems = guestGrantProblems(grant, { now });
  if (problems.length) return { decision: "deny", allowed: false, reasons: problems.map((p) => p.message) };
  let own;
  try {
    own = principalTenant(guest);
  } catch {
    return { decision: "deny", allowed: false, reasons: ["gæstens tenantbinding kunne ikke udledes"] };
  }
  if (!own || own !== normalizeTenantId(grant.tenantId)) {
    return { decision: "deny", allowed: false, reasons: ["gæsten tilhører ikke den tenant bevillingen gælder"] };
  }
  if (!READ_ACTIONS.has(String(action))) {
    return { decision: "deny", allowed: false, reasons: ["en gæst må kun læse"] };
  }
  const wanted = typeof resource === "string" ? resource : resource?.id ?? null;
  if (!wanted || !grant.resources.includes(wanted)) {
    return { decision: "deny", allowed: false, reasons: [`ressourcen '${wanted ?? "?"}' er ikke en del af gæstebevillingen`] };
  }
  if (field !== null && field !== undefined) {
    const name = String(field).trim().toLowerCase();
    if (!grant.fields.map((f) => String(f).trim().toLowerCase()).includes(name)) {
      return { decision: "deny", allowed: false, reasons: [`feltet '${name}' er ikke delt med gæsten`] };
    }
  }
  return { decision: "allow", allowed: true, reasons: [] };
}
