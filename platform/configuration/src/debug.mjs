/**
 * DKC-054 — debug-vindue og uforanderligt revisionsspor.
 *
 * Debug er en tidsbegrænset diagnostik, ikke en permanent tilstand. Når TTL
 * udløber, er debug slukket uden et nyt menneskeligt indgreb. Revisionssporet og
 * de sikkerhedshændelser, der kræves af loggepolitikken, skrives uafhængigt af
 * logniveauet — et lavere logniveau kan skjule støj, aldrig revisionen.
 */
import { effectiveSettings, MAX_DEBUG_TTL_SECONDS } from "./model.mjs";

/** Hændelser der altid skal registreres, uanset valgt logniveau. */
export const MANDATORY_AUDIT_EVENTS = Object.freeze([
  "config.change",
  "config.debug.enabled",
  "config.debug.disabled",
  "auth.decision",
  "approval.granted",
  "approval.rejected",
  "retention.change",
  "installer.step",
  "secret.access",
]);

const LEVEL_RANK = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

export function debugState(config, now = Date.now(), scope = {}) {
  const debug = effectiveSettings(config, scope).debug ?? {};
  const expires = Date.parse(debug.expiresAt ?? "");
  const active = debug.enabled === true && Number.isFinite(expires) && expires > now;
  return {
    enabled: debug.enabled === true,
    active,
    expiresAt: debug.expiresAt ?? null,
    remainingSeconds: active ? Math.max(0, Math.floor((expires - now) / 1000)) : 0,
    reason: debug.reason ?? null,
    requestedBy: debug.requestedBy ?? null,
    maxTtlSeconds: MAX_DEBUG_TTL_SECONDS,
  };
}

/**
 * Hvilke hændelser registreres ved det valgte logniveau? De obligatoriske
 * revisionsevents er altid med; kun støjniveauerne filtreres.
 */
export function eventsRecordedAt(logLevel) {
  if (!(logLevel in LEVEL_RANK)) throw new Error(`Ukendt logniveau '${logLevel}'`);
  return {
    logLevel,
    mandatory: [...MANDATORY_AUDIT_EVENTS],
    filterable: LEVEL_RANK[logLevel] <= LEVEL_RANK.info,
    note: "Obligatoriske revisionsevents kan ikke filtreres væk med logniveauet.",
  };
}

/** Revisionssporet må ikke kunne deaktiveres — hverken direkte eller via logniveau. */
export function assertAuditTrailActive(config) {
  if (config?.enforcement?.auditTrailImmutable !== true) {
    throw new Error("revisionssporet er ikke uforanderligt i konfigurationen");
  }
  for (const event of MANDATORY_AUDIT_EVENTS) {
    if (!eventsRecordedAt(config?.installation?.logLevel ?? "info").mandatory.includes(event)) {
      throw new Error(`det obligatoriske revisionsevent '${event}' kan ikke registreres`);
    }
  }
  return true;
}

export function renderDebugStatus(config, now = Date.now(), scope = {}) {
  const state = debugState(config, now, scope);
  if (!state.enabled) return "Debug er slukket (sikker standard).";
  if (!state.active) return `Debug udløb ${state.expiresAt}; aktivt revisionsspor fortsætter.`;
  return `Debug er aktivt i ${state.remainingSeconds}s (udløber ${state.expiresAt}).`;
}
