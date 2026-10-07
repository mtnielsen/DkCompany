/**
 * DKC-030 — default-deny adgang for CRM med rollebeskyttelse.
 *
 * Tenant udledes af den **verifikerede** principal og skal matche postens
 * tenant, så et salgsteam ikke kan læse en anden kundes CRM. En principal skal
 * desuden have en rolle der (a) optræder i postens rollegruppe og (b) må læse
 * den pågældende entitetstype i kilden. Klassifikationen er et loft, og en
 * eksplicit ACL kan nægte eller tillade et subjekt.
 */
import { classificationRank, principalClearance } from "./model.mjs";

/** Normalisér en verificeret principal uden at opfinde felter. */
export function normalizePrincipal(principal) {
  if (!principal || typeof principal !== "object") return null;
  const roles = [...new Set([...(principal.roles ?? []), ...(principal.groups ?? [])].map(String))];
  return {
    subject: principal.id ?? principal.subject ?? null,
    tenantId: principal.tenantId ?? null,
    roles,
    clearance: principalClearance(principal),
    kind: principal.kind ?? "unknown",
  };
}

/** Afgør om en principal overhovedet har en rolle i en kilde. */
export function roleAllowedForEntity(source, role, entityType) {
  const def = source?.roles?.[role];
  if (!def) return false;
  return def.read === true && (def.entityTypes ?? []).includes(entityType);
}

/**
 * Afgør om en principal må læse en post.
 *
 * @returns `{ allowed, reason }`. `reason` er stabil og lækker ikke indhold.
 */
export function decideRecordAccess({ principal, record, source = null } = {}) {
  const p = normalizePrincipal(principal);
  if (!p) return { allowed: false, reason: "no-principal" };
  if (!p.tenantId) return { allowed: false, reason: "no-tenant" };
  if (!record) return { allowed: false, reason: "no-record" };
  if (record.deletedAt) return { allowed: false, reason: "deleted" };
  if (record.tenantId !== p.tenantId) return { allowed: false, reason: "tenant-mismatch" };

  const rules = record.acl ?? {};
  const subject = String(p.subject ?? "");
  if ((rules.denySubjects ?? []).includes(subject)) return { allowed: false, reason: "deny-subject" };
  if ((rules.denyGroups ?? []).some((g) => p.roles.includes(String(g)))) return { allowed: false, reason: "deny-group" };

  // Rollebeskyttelse: principalen skal have en rolle der må læse entitetstypen.
  const validRoles = source
    ? p.roles.filter((role) => roleAllowedForEntity(source, role, record.entityType))
    : p.roles.filter((role) => (record.roles ?? []).includes(role));
  if (validRoles.length === 0) return { allowed: false, reason: "role" };

  const subjectAllowed = subject && (rules.readSubjects ?? []).includes(subject);
  const groupAllowed = (rules.readGroups ?? []).some((g) => p.roles.includes(String(g)));
  if (!subjectAllowed && !groupAllowed && (rules.readGroups ?? []).length + (rules.readSubjects ?? []).length > 0) {
    return { allowed: false, reason: "acl" };
  }

  // Klassifikationsloft.
  if (classificationRank(record.classification) > classificationRank(p.clearance) && !subjectAllowed) {
    return { allowed: false, reason: "classification" };
  }
  return { allowed: true, reason: subjectAllowed ? "read-subject" : validRoles.length ? "read-role" : "read" };
}

/** Må principalen skrive (oprette/opdatere) en post i kilden? */
export function decideRecordWrite({ principal, record, source = null } = {}) {
  const decision = decideRecordAccess({ principal, record, source });
  if (!decision.allowed) return decision;
  const p = normalizePrincipal(principal);
  const writable = p.roles.some((role) => source?.roles?.[role]?.write === true && (source.roles[role].entityTypes ?? []).includes(record.entityType));
  if (!writable) return { allowed: false, reason: "write-role" };
  return { allowed: true, reason: "write-role" };
}

/** Filtrér poster for en principal **før** indhold læses. Fail-closed. */
export function filterAuthorizedRecords({ principal, records, source = null, sourceResolver = null } = {}) {
  const authorized = [];
  const denied = [];
  const tombstoned = [];
  for (const record of records) {
    if (record.deletedAt) {
      tombstoned.push(record);
      continue;
    }
    let resolvedSource = source;
    if (sourceResolver) {
      try {
        resolvedSource = sourceResolver(record) ?? source;
      } catch {
        denied.push({ record, reason: "source-unavailable" });
        continue;
      }
    }
    const decision = decideRecordAccess({ principal, record, source: resolvedSource });
    if (decision.allowed) authorized.push(record);
    else denied.push({ record, reason: decision.reason });
  }
  return { authorized, denied, tombstoned };
}
