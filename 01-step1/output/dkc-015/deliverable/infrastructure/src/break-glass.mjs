/**
 * DKC-015 — autoriseret break-glass.
 *
 * Break-glass er en tidsbegrænset, godkendt, scope-bundet undtagelse fra den
 * normale ændringsvej. Den kan ikke bruges af en agent, kan ikke selvgodkendes,
 * og udløber automatisk. Beslutningen er en ren funktion, så den kan
 * efterprøves uden en klynge.
 */
export const BREAK_GLASS_SCOPES = ["read-audit", "restart-workload", "rotate-credential", "restore-backup", "drain-node"];

export function authorizeBreakGlass(request, plan, { now = () => new Date() } = {}) {
  const policy = plan?.bootstrap?.breakGlass ?? {};
  const reasons = [];
  const requester = request?.requester ?? {};
  const approver = request?.approver ?? {};

  if (!requester.subject || requester.kind === "agent") reasons.push("rekvirenten skal være et verificeret menneske, ikke en agent");
  if (!approver.subject || approver.kind === "agent") reasons.push("break-glass skal godkendes af et navngivet menneske, ikke en agent");
  if (requester.subject && requester.subject === approver.subject) reasons.push("godkenderen må ikke være den samme som rekvirenten");
  if (!(request?.reason ?? "").trim()) reasons.push("break-glass kræver en skriftlig begrundelse");

  const allowed = new Set(policy.scope ?? []);
  for (const scope of request?.scope ?? []) {
    if (!allowed.has(scope)) reasons.push(`scope '${scope}' er ikke tilladt for break-glass`);
  }
  if (!(request?.scope ?? []).length) reasons.push("break-glass kræver mindst ét scope");

  const max = policy.maxDurationMinutes ?? 0;
  if (!Number.isFinite(request?.durationMinutes) || request.durationMinutes < 1 || request.durationMinutes > max) {
    reasons.push(`varigheden skal være mellem 1 og ${max} minutter`);
  }

  if (reasons.length) return { ok: false, reasons, grant: null };
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + request.durationMinutes * 60_000).toISOString();
  return {
    ok: true,
    reasons: [],
    grant: {
      id: request.id ?? `bg-${issuedAt.toISOString()}`,
      scope: request.scope,
      issuedAt: issuedAt.toISOString(),
      expiresAt,
      approvedBy: approver.subject,
      audit: true,
      contact: policy.contact,
    },
  };
}
