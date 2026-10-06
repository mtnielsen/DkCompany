/**
 * DKC-028 — tenant- og ACL-afgørelse for vidensdokumenter.
 *
 * Reglen er default-deny. Tenant udledes af den **verificerede** principal og
 * skal matche dokumentets tenant. Et dokument er kun læsbart hvis principalen
 * står i readSubjects, eller deler en readGroups-gruppe, og ikke er nævnt i en
 * deny-liste. Klassifikationen er et ekstra loft: et fortroligt eller
 * særligt-følsomt dokument kræver en tilsvarende klarering, så en bred gruppe
 * ikke stiltiende kan åbne det.
 */
import { principalClearance, classificationRank } from "./model.mjs";

/** Normalisér en verificeret principal uden at opfinde felter. */
export function normalizePrincipal(principal) {
  if (!principal || typeof principal !== "object") return null;
  const groups = [...(principal.groups ?? []), ...(principal.roles ?? [])].map(String);
  return {
    subject: principal.id ?? principal.subject ?? null,
    tenantId: principal.tenantId ?? null,
    groups,
    roles: [...(principal.roles ?? [])].map(String),
    clearance: principalClearance(principal),
    kind: principal.kind ?? "unknown",
  };
}

/**
 * Afgør om en principal må læse et dokument.
 *
 * @returns `{ allowed, reason }`. `reason` er stabil og lækker ikke indhold.
 */
export function decideDocumentAccess({ principal, document, acl = null } = {}) {
  const p = normalizePrincipal(principal);
  if (!p) return { allowed: false, reason: "no-principal" };
  if (!p.tenantId) return { allowed: false, reason: "no-tenant" };
  if (!document) return { allowed: false, reason: "no-document" };
  if (document.deletedAt) return { allowed: false, reason: "deleted" };
  if (document.tenantId !== p.tenantId) return { allowed: false, reason: "tenant-mismatch" };

  const rules = acl ?? document.acl ?? {};
  const subject = String(p.subject ?? "");
  const groups = new Set(p.groups);

  if ((rules.denySubjects ?? []).includes(subject)) return { allowed: false, reason: "deny-subject" };
  if ((rules.denyGroups ?? []).some((g) => groups.has(String(g)))) return { allowed: false, reason: "deny-group" };

  const subjectAllowed = subject && (rules.readSubjects ?? []).includes(subject);
  const groupAllowed = (rules.readGroups ?? []).some((g) => groups.has(String(g)));
  if (!subjectAllowed && !groupAllowed) return { allowed: false, reason: "acl" };

  // Klassifikationsloft: fortrolige/særligt følsomme dokumenter kræver klarering.
  if (classificationRank(document.classification) > classificationRank(p.clearance) && !subjectAllowed) {
    return { allowed: false, reason: "classification" };
  }
  return { allowed: true, reason: subjectAllowed ? "read-subject" : "read-group" };
}

/**
 * Filtrér dokumenter for en principal **før** nogen scoring. En resolver kan
 * give den aktuelle ACL fra kilden; hvis den fejler, nægtes dokumentet
 * (fail-closed), så en tilbagekaldt rettighed ikke kan omgås af et gammelt
 * indeks.
 */
export function filterAuthorized({ principal, documents, aclResolver = null } = {}) {
  const authorized = [];
  const denied = [];
  const tombstoned = [];
  for (const doc of documents) {
    if (doc.deletedAt) {
      tombstoned.push(doc);
      continue;
    }
    let acl = doc.acl;
    if (aclResolver) {
      try {
        acl = aclResolver(doc) ?? doc.acl;
      } catch {
        denied.push({ document: doc, reason: "acl-unavailable" });
        continue;
      }
    }
    const decision = decideDocumentAccess({ principal, document: doc, acl });
    if (decision.allowed) authorized.push(doc);
    else denied.push({ document: doc, reason: decision.reason });
  }
  return { authorized, denied, tombstoned };
}
