/**
 * DKC-058 — eksplicit host-enrollment.
 *
 * Et host må kun komme under styring gennem en menneskelig, out-of-band
 * bootstrap og en verificeret trust. Host-styring er slået fra som standard og
 * kan kun slås til af et navngivet menneske med en platformejer-/adminrolle.
 * Et ikke-understøttet OS afvises af ejeren, ikke af en agent.
 */
import { enrollmentProblems, hostManagementEnabled, supportedPlatform } from "./model.mjs";

export const ALLOWED_ENABLE_ROLES = ["platform-owner", "platform-admin", "security-owner"];

function namedHuman(actor) {
  return Boolean(actor && actor.kind === "human" && /^[a-z][a-z0-9-]*\|/.test(actor.subject ?? ""));
}

export class EnrollmentError extends Error {
  constructor(message, code = "enrollment_error") {
    super(message);
    this.name = "EnrollmentError";
    this.code = code;
  }
}

/**
 * Validér et enrollment. Returnerer den kanoniske, stadig slukkede tilstand.
 * Funktionen slår aldrig host-styring til — det kræver et separat,
 * menneskeligt `enableManagement`.
 */
export function enrollHost({ enrollment, actor, platforms, profile = null } = {}) {
  const problems = enrollmentProblems(enrollment, { platforms, profile });
  if (!namedHuman(actor)) problems.push({ path: "/bootstrap/performedBy", message: "enrollment skal udføres af et navngivet, verificeret menneske" });
  if (enrollment?.bootstrap?.performedBy !== actor?.subject) problems.push({ path: "/bootstrap/performedBy", message: "bootstrap-udføreren skal være den verificerede principal" });
  const platform = supportedPlatform(enrollment, platforms);
  return {
    ok: problems.length === 0,
    problems,
    platform,
    enabled: false,
    enrollment: problems.length === 0 ? { ...structuredClone(enrollment), management: { ...enrollment.management, enabled: false, enabledBy: null, enabledAt: null } } : null,
  };
}

/** Slå host-styring til. Kun et navngivet menneske med en passende rolle. */
export function enableManagement({ enrollment, actor, role, profileRef = null, justification = null, now = Date.now() } = {}) {
  if (!namedHuman(actor)) return { ok: false, reason: "kun et navngivet menneske må slå host-styring til", code: "human_required" };
  if (!ALLOWED_ENABLE_ROLES.includes(role?.id)) return { ok: false, reason: `rollen '${role?.id ?? "ukendt"}' må ikke slå host-styring til`, code: "role_required" };
  if (!enrollment?.management?.enabled && !(justification ?? enrollment?.management?.justification ?? "").trim()) {
    return { ok: false, reason: "aktivering kræver en begrundelse", code: "justification_required" };
  }
  const next = structuredClone(enrollment);
  next.management = {
    ...next.management,
    enabled: true,
    profileRef: profileRef ?? next.management.profileRef,
    enabledBy: actor.subject,
    enabledAt: new Date(now).toISOString(),
    justification: justification ?? next.management.justification,
  };
  return { ok: true, enrollment: next };
}

/** Slå host-styring fra. Altid tilladt for et navngivet menneske. */
export function disableManagement({ enrollment, actor } = {}) {
  if (!namedHuman(actor)) return { ok: false, reason: "kun et navngivet menneske må slå host-styring fra", code: "human_required" };
  const next = structuredClone(enrollment);
  next.management = { ...next.management, enabled: false, enabledBy: null, enabledAt: null };
  return { ok: true, enrollment: next };
}

/**
 * Verificér den præsenterede trust mod enrollmentet. Default-deny: begge
 * fingeraftryk skal matche, ellers afvises forbindelsen.
 */
export function verifyTrust({ enrollment, presented = {} } = {}) {
  const reasons = [];
  if (presented.caFingerprint !== enrollment?.trust?.caFingerprint) reasons.push("CA-fingeraftrykket matcher ikke");
  if (presented.sshHostKeyFingerprint !== enrollment?.trust?.sshHostKeyFingerprint) reasons.push("SSH-hostkey-fingeraftrykket matcher ikke");
  if (enrollment?.trust?.verified !== true) reasons.push("enrollmentets tillid er ikke verificeret");
  return { ok: reasons.length === 0, reasons };
}

export function inventorySummary(enrollment) {
  return {
    hostId: enrollment?.host?.id ?? null,
    platformRef: enrollment?.host?.platformRef ?? null,
    roles: enrollment?.inventory?.roles ?? [],
    cpuCores: enrollment?.inventory?.cpuCores ?? 0,
    memoryMiB: enrollment?.inventory?.memoryMiB ?? 0,
    diskGiB: enrollment?.inventory?.diskGiB ?? 0,
    managed: hostManagementEnabled(enrollment),
  };
}

export { enrollmentProblems, hostManagementEnabled, supportedPlatform };
