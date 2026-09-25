/**
 * DKC-058 — sikkerhedsporte omkring en host-operation.
 *
 * Tre ting må ikke overlades til en agent:
 *
 *   1. En ændring af SSH/firewall/netværk må ikke lukke den eneste
 *      recoveryvej. Kræver den det, skal et **andet** menneske træffe en
 *      særskilt beslutning.
 *   2. En mutation skal ligge i et annonceret vedligeholdelsesvindue og have en
 *      canary, der er observeret sund, før resten af flåden røres.
 *   3. Et stopkriterium skal stoppe forløbet — ikke ties ihjel.
 */
export const RECOVERY_CRITICAL_SURFACES = ["ssh", "firewall", "network", "console", "dns"];

export class SafetyHalt extends Error {
  constructor(message, code = "safety_halt") {
    super(message);
    this.name = "SafetyHalt";
    this.code = code;
  }
}

/**
 * Kan ændringen lukke den eneste recoveryvej? Hvis ja, kræves en separat,
 * navngiven menneskelig beslutning fra en anden person end den, der godkendte
 * operationen.
 */
export function guardRecoveryPath({ change = {}, approval = {}, separateDecision = null } = {}) {
  const surfaces = change.surfaces ?? [];
  const touched = surfaces.filter((s) => RECOVERY_CRITICAL_SURFACES.includes(s));
  if (touched.length === 0) return { ok: true, reason: "ingen recovery-kritisk flade berøres" };

  const recovery = change.recoveryPath ?? {};
  if (recovery.outOfBand === true && !(recovery.dependsOn ?? []).some((s) => touched.includes(s))) {
    return { ok: true, reason: "recoveryvejen ligger uden for den ændrede flade" };
  }

  if (!separateDecision || !/^[a-z][a-z0-9-]*\|/.test(separateDecision.humanSubject ?? "")) {
    return { ok: false, code: "recovery_decision_required", reason: "ændringen kan lukke den eneste recoveryvej og kræver en særskilt menneskelig beslutning" };
  }
  if (separateDecision.humanSubject === approval.humanSubject) {
    return { ok: false, code: "recovery_two_person_required", reason: "den særskilte beslutning skal træffes af et andet menneske end godkenderen" };
  }
  if (separateDecision.accepted !== true) {
    return { ok: false, code: "recovery_decision_not_accepted", reason: "den særskilte beslutning er ikke accepteret" };
  }
  return { ok: true, reason: `særskilt beslutning fra ${separateDecision.humanSubject}` };
}

/** Er tidspunktet inden for et annonceret vedligeholdelsesvindue? */
export function withinMaintenanceWindow({ profile, windows = [], at = Date.now() } = {}) {
  const announcedLead = (profile?.maintenanceWindow?.announcedLeadTimeSeconds ?? 0) * 1000;
  const active = windows.find((w) => at >= Date.parse(w.start) && at <= Date.parse(w.end));
  if (!active) return { ok: false, code: "outside_maintenance_window", reason: "tidspunktet ligger uden for et vedligeholdelsesvindue" };
  if (Date.parse(active.announcedAt ?? active.start) + announcedLead > at) {
    return { ok: false, code: "window_not_announced", reason: "vinduet er ikke annonceret i god nok tid" };
  }
  return { ok: true, window: active };
}

/** Canary-port: den udpegede host skal være observeret sund, før resten røres. */
export function canaryGate({ operation, health = {} } = {}) {
  const canary = operation?.scope?.canary ?? null;
  if (!canary) return { ok: false, code: "canary_required", reason: "en mutation kræver en canary-host" };
  const observed = health[canary.hostRef];
  if (observed === undefined) return { ok: false, code: "canary_not_observed", reason: `canary-hosten '${canary.hostRef}' er ikke observeret` };
  if (observed !== true) return { ok: false, code: "canary_unhealthy", reason: `canary-hosten '${canary.hostRef}' er ikke sund` };
  return { ok: true, canary: canary.hostRef, waitSeconds: canary.waitSeconds };
}

/** Stopkriterier: enhver sand signal stopper forløbet. */
export function evaluateStopCriteria({ operation, signals = {} } = {}) {
  const triggered = (operation?.safety?.stopCriteria ?? []).filter((id) => signals[id] === true);
  if (triggered.length) return { ok: false, code: "stop_criteria_triggered", triggered, reason: `stopkriterier udløst: ${triggered.join(", ")}` };
  return { ok: true, triggered: [] };
}

/**
 * Samlet gate før en muterende operation. Returnerer `{ ok, reasons }`; enhver
 * manglende forudsætning stopper forløbet (fail-closed).
 */
export function mutationGate({ operation, profile = null, windows = [], health = {}, signals = {}, at = Date.now() } = {}) {
  const reasons = [];
  const window = withinMaintenanceWindow({ profile, windows, at });
  if (!window.ok) reasons.push(window.reason);
  const canary = canaryGate({ operation, health });
  if (!canary.ok) reasons.push(canary.reason);
  const stop = evaluateStopCriteria({ operation, signals });
  if (!stop.ok) reasons.push(stop.reason);
  return { ok: reasons.length === 0, reasons, window: window.window ?? null, canary: canary.canary ?? null };
}
