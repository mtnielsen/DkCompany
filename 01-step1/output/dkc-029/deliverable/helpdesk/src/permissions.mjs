/**
 * DKC-029 — default-deny adgang for support og sagsbehandling.
 *
 * Tenant udledes af den **verificerede** principal og skal matche sagens tenant.
 * En intern agent skal stå i køens readSubjects eller dele en readGroups-gruppe
 * og ikke være nævnt i en deny-liste. En ekstern kunde ser **kun egne sager**
 * (rekvirenten matcher principalens subjekt) og kun i køer der er
 * `externalVisible`. Klassifikationen er et ekstra loft: en fortrolig sag
 * kræver en tilsvarende klarering, så en bred gruppe ikke stiltiende kan åbne
 * den.
 */
import { classificationRank, principalClearance, isExternalCustomer } from "./model.mjs";

/** Normalisér en verificeret principal uden at opfinde felter. */
export function normalizePrincipal(principal) {
  if (!principal || typeof principal !== "object") return null;
  const groups = [...(principal.groups ?? []), ...(principal.roles ?? [])].map(String);
  return {
    subject: principal.id ?? principal.subject ?? null,
    tenantId: principal.tenantId ?? null,
    email: principal.email ?? null,
    groups,
    roles: [...(principal.roles ?? [])].map(String),
    clearance: principalClearance(principal),
    kind: principal.kind ?? "unknown",
    external: isExternalCustomer(principal),
  };
}

/** Find en kø i en kilde. */
export function findQueue(source, queueId) {
  return (source?.queues ?? []).find((q) => q.id === queueId) ?? null;
}

/**
 * Afgør om en principal må læse en sag.
 *
 * @returns `{ allowed, reason }`. `reason` er stabil og lækker ikke indhold.
 */
export function decideTicketAccess({ principal, ticket, queue = null } = {}) {
  const p = normalizePrincipal(principal);
  if (!p) return { allowed: false, reason: "no-principal" };
  if (!p.tenantId) return { allowed: false, reason: "no-tenant" };
  if (!ticket) return { allowed: false, reason: "no-ticket" };
  if (ticket.deletedAt) return { allowed: false, reason: "deleted" };
  if (ticket.tenantId !== p.tenantId) return { allowed: false, reason: "tenant-mismatch" };

  const q = queue ?? ticket.queue ?? null;
  const rules = q?.acl ?? ticket.acl ?? {};
  const subject = String(p.subject ?? "");
  const groups = new Set(p.groups);

  if ((rules.denySubjects ?? []).includes(subject)) return { allowed: false, reason: "deny-subject" };
  if ((rules.denyGroups ?? []).some((g) => groups.has(String(g)))) return { allowed: false, reason: "deny-group" };

  // En ekstern kunde ser kun egne sager, og kun i eksternt synlige køer.
  if (p.external) {
    if (q && q.externalVisible !== true) return { allowed: false, reason: "queue-not-external" };
    if (ticket.requester?.subject !== subject) return { allowed: false, reason: "not-requester" };
    return { allowed: true, reason: "requester" };
  }

  const subjectAllowed = subject && (rules.readSubjects ?? []).includes(subject);
  const groupAllowed = (rules.readGroups ?? []).some((g) => groups.has(String(g)));
  if (!subjectAllowed && !groupAllowed) return { allowed: false, reason: "queue-acl" };

  // Klassifikationsloft: fortrolige sager kræver klarering, medmindre subjektet
  // er eksplicit nævnt i køens ACL.
  if (classificationRank(ticket.classification) > classificationRank(p.clearance) && !subjectAllowed) {
    return { allowed: false, reason: "classification" };
  }
  return { allowed: true, reason: subjectAllowed ? "read-subject" : "read-group" };
}

/**
 * Filtrér sager for en principal **før** noget indhold læses. En resolver kan
 * give den aktuelle kø/ACL fra kilden; hvis den fejler, nægtes sagen
 * (fail-closed).
 */
export function filterAuthorizedTickets({ principal, tickets, queueResolver = null } = {}) {
  const authorized = [];
  const denied = [];
  const tombstoned = [];
  for (const ticket of tickets) {
    if (ticket.deletedAt) {
      tombstoned.push(ticket);
      continue;
    }
    let queue = ticket.queue ?? null;
    if (queueResolver) {
      try {
        queue = queueResolver(ticket) ?? queue;
      } catch {
        denied.push({ ticket, reason: "queue-unavailable" });
        continue;
      }
    }
    const decision = decideTicketAccess({ principal, ticket, queue });
    if (decision.allowed) authorized.push(ticket);
    else denied.push({ ticket, reason: decision.reason });
  }
  return { authorized, denied, tombstoned };
}
