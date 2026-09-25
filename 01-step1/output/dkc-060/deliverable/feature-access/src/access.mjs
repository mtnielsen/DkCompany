/**
 * DKC-060 — adgangsmotoren for ressource-, række- og feltniveau.
 *
 * Grundregler:
 *   - der findes ingen adgang uden en verificeret principal med tenantbinding;
 *   - tenanten udledes af principalen, aldrig af et felt klienten kan sætte;
 *   - adgang er default-deny på feltniveau; et beskyttet felt kræver en
 *     eksplicit bevilling, og det er ikke nok at være logget ind (SSO);
 *   - den samme beslutning skal gælde på alle syv flader. En flade der svarer
 *     noget andet, er en fejl — ikke en undtagelse;
 *   - rækker filtreres tenantstrengt og derefter efter politik; intet match
 *     betyder at rækken ikke returneres.
 */
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { normalizeTenantId, principalTenant, formatResourceId, parseResourceId } from "../../identity/src/tenant.mjs";
import { SURFACES, PROTECTED_FIELD_CLASSES, READ_ACTIONS } from "./constants.mjs";

export function normalizeField(field) {
  return String(field ?? "").trim().toLowerCase();
}

export function grantsOf(principal) {
  return new Set([...(principal?.grants ?? []), ...(principal?.scopes ?? [])].map((g) => String(g)));
}

export function fieldRuleFor(profile, field) {
  const wanted = normalizeField(field);
  return (profile?.fieldRules?.fields ?? []).find((rule) => normalizeField(rule.field) === wanted) ?? null;
}

/** Feltniveau: hvert felt afgøres for sig. */
export function decideFieldAccess({ principal, profile, field, action = "read" } = {}) {
  const name = normalizeField(field);
  const rule = fieldRuleFor(profile, field);
  const decision = rule?.decision ?? profile?.fieldRules?.defaultDecision ?? "deny";
  if (decision === "deny") {
    return { field: name, dataClass: rule?.dataClass ?? "internal", decision: "deny", reason: rule ? rule.note ?? `feltet '${name}' er nægtet i profilen '${profile?.id}'` : `feltet '${name}' er nægtet som standard i profilen '${profile?.id}'` };
  }
  if (decision === "redact") {
    return { field: name, dataClass: rule?.dataClass ?? "internal", decision: "redact", reason: rule?.note ?? `feltet '${name}' returneres tilbageholdt` };
  }
  if (rule?.requiresGrant && !grantsOf(principal).has(rule.requiresGrant)) {
    return {
      field: name,
      dataClass: rule.dataClass,
      decision: "deny",
      reason: `feltet '${name}' kræver den eksplicitte bevilling '${rule.requiresGrant}'; et almindeligt login er ikke tilstrækkeligt`,
    };
  }
  return { field: name, dataClass: rule?.dataClass ?? "internal", decision: "allow", reason: null };
}

function resourceRef(resource = {}) {
  if (typeof resource === "string" && resource.startsWith("res://")) {
    const parsed = parseResourceId(resource);
    return { tenantId: parsed.tenantId, type: parsed.type, localId: parsed.localId, id: resource };
  }
  if (resource?.id) return { tenantId: resource.tenantId ?? null, type: resource.type ?? "resource", localId: resource.localId ?? resource.id, id: resource.id };
  if (resource?.localId && resource?.type && resource?.tenantId) {
    return { ...resource, id: formatResourceId(resource) };
  }
  return { tenantId: resource?.tenantId ?? null, type: resource?.type ?? "resource", localId: resource?.localId ?? null, id: null };
}

/**
 * Samlet beslutning for én flade. Returnerer et struktureret resultat.
 * `decision` er `allow`, `redact` eller `deny`.
 */
export function decideAccess({ principal, profile, resource = {}, fields = [], action = "read", purpose = null, surface = "api", now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const requested = (Array.isArray(fields) ? fields : [fields]).filter((f) => f !== undefined && f !== null).map(normalizeField);
  const ref = resourceRef(resource);
  const base = {
    kind: "AccessDecision",
    profile: profile?.id ?? null,
    purpose: profile?.purpose ?? null,
    surface,
    action,
    resource: ref.id ?? null,
    decidedAt: at,
  };
  const deny = (reason, extra = {}) => ({
    ...base,
    decision: "deny",
    allowedFields: [],
    redactedFields: [],
    deniedFields: requested,
    reasons: [reason],
    ...extra,
  });

  if (!principal || !principal.id) return deny("der findes ingen verificeret principal");
  if (principal.authenticated === false) return deny("principalen er ikke autentificeret");
  if (!profile) return deny("der er ingen funktionsprofil at vurdere imod");

  let own;
  try {
    own = principalTenant(principal);
  } catch {
    return deny("principalens tenantbinding kunne ikke udledes");
  }
  if (!own) return deny("principalen mangler tenantbinding; adgang kan ikke udledes");

  if (ref.tenantId) {
    let target;
    try {
      target = normalizeTenantId(ref.tenantId);
    } catch {
      return deny("ressourcens tenant-id er ugyldigt");
    }
    if (target !== own) return deny(`ressourcen tilhører kunden '${target}', ikke principalens kunde '${own}'`);
  }

  if (purpose && purpose !== profile.purpose) {
    return deny(`formålet '${purpose}' svarer ikke til profilens formål '${profile.purpose}'`);
  }

  if (!READ_ACTIONS.has(String(action))) {
    return deny(`handlingen '${action}' er ikke en læsehandling på denne flade og kræver et separat godkendt flow`);
  }

  const fieldResults = requested.map((field) => decideFieldAccess({ principal, profile, field, action }));
  const allowedFields = fieldResults.filter((r) => r.decision === "allow").map((r) => r.field);
  const redactedFields = fieldResults.filter((r) => r.decision === "redact").map((r) => r.field);
  const deniedFields = fieldResults.filter((r) => r.decision === "deny").map((r) => r.field);
  const reasons = fieldResults.filter((r) => r.decision !== "allow").map((r) => r.reason).filter(Boolean);

  const decision = deniedFields.length ? "deny" : redactedFields.length ? "redact" : "allow";
  return { ...base, decision, allowedFields, redactedFields, deniedFields, reasons };
}

/** Kaster hvis beslutningen ikke er en tilladelse. */
export function assertAccess(options) {
  const result = decideAccess(options);
  if (result.decision !== "allow") {
    const error = new AuthorizationError(result.reasons[0] ?? "adgang nægtet", { status: 403, code: "access_denied" });
    error.decision = result.decision;
    throw error;
  }
  return result;
}

/**
 * Rækkeniveau. Tenantstramt først, derefter politik:
 *   - egen række (selfAttribute == principal.id) bevares;
 *   - en attributregel bevarer rækker hvor rækkens attribut matcher principalens
 *     claim, men kun hvis principalen har den krævede bevilling;
 *   - intet match betyder at rækken ikke returneres (default-deny).
 */
export function filterRows({ principal, profile, rows = [] } = {}) {
  const own = principalTenant(principal);
  if (!own) return [];
  const policy = profile?.rowPolicy ?? {};
  const grants = grantsOf(principal);
  const selfAttribute = policy.selfAttribute ?? "subject";
  const keep = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.tenantId !== undefined && row.tenantId !== null) {
      let rowTenant;
      try {
        rowTenant = normalizeTenantId(row.tenantId);
      } catch {
        continue;
      }
      if (rowTenant !== own) continue;
    }
    const attributes = row.attributes ?? {};
    if (attributes[selfAttribute] !== undefined && attributes[selfAttribute] === principal.id) {
      keep.push(row);
      continue;
    }
    if (policy.requiredAttribute && policy.requiresGrant) {
      const claimed = principal.claims?.[policy.requiredAttribute];
      if (claimed !== undefined && attributes[policy.requiredAttribute] === claimed && grants.has(policy.requiresGrant)) {
        keep.push(row);
      }
    }
  }
  return keep;
}

/** Én flade med eksplicit fladenavn i resultatet. */
export function evaluateAccessOnSurface(input = {}) {
  const result = decideAccess(input);
  return { surface: input.surface, ...result };
}

/** Den samme beslutning evalueret på alle syv flader. */
export function evaluateAcrossSurfaces(input = {}) {
  return SURFACES.map((surface) => evaluateAccessOnSurface({ ...input, surface }));
}

/**
 * Returnerer de flader hvis beslutning afviger fra den første flade. En tom
 * liste betyder at UI/API/connector/søgning/eksport/cache/AI-værktøj håndhæver
 * samme rettigheder.
 */
export function surfaceConsistencyProblems(input = {}) {
  const results = evaluateAcrossSurfaces(input);
  const reference = results[0];
  const problems = [];
  for (const result of results.slice(1)) {
    if (result.decision !== reference.decision) {
      problems.push(`fladen '${result.surface}' gav '${result.decision}', men '${reference.surface}' gav '${reference.decision}'`);
      continue;
    }
    if (JSON.stringify(result.allowedFields) !== JSON.stringify(reference.allowedFields)) {
      problems.push(`fladen '${result.surface}' tillod felterne [${result.allowedFields}], mens '${reference.surface}' tillod [${reference.allowedFields}]`);
    }
  }
  return problems;
}

export { PROTECTED_FIELD_CLASSES };
