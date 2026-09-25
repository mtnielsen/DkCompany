/**
 * DKC-022 — brudøvelse med dokumenteret beslutning om anmeldelse/kommunikation.
 *
 * En øvelse er en deterministisk simulering: den tager en syntetisk hændelse og
 * et menneskeligt beslutningsinput, beregner de indberetningsfrister der følger
 * af registeret og dokumenterer beslutningen. Den erstatter ikke en rigtig
 * brudøvelse med et navngivet menneske; den gør mekanismen efterprøvelig og
 * gør det umuligt at "dokumentere" en beslutning uden en ansvarlig person.
 */
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export class IncidentExerciseError extends Error {
  constructor(message, code = "incident_exercise_error") {
    super(message);
    this.name = "IncidentExerciseError";
    this.code = code;
  }
}

export const INCIDENT_SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);

/**
 * Kør en brudøvelse.
 *
 * @param {object} opts
 * @param {object} opts.register
 * @param {object} opts.scenario  `{ id, detectedAt, severity, personalDataAffected, decision }`.
 * @param {number} [opts.now]
 */
export function runBreachExercise({ register, scenario, now = Date.now() } = {}) {
  if (!register) throw new IncidentExerciseError("runBreachExercise kræver et register", "missing_register");
  if (!scenario || typeof scenario.id !== "string" || scenario.id.trim() === "") {
    throw new IncidentExerciseError("scenariet mangler et id", "missing_scenario");
  }
  const detected = Date.parse(scenario.detectedAt);
  if (!Number.isFinite(detected)) throw new IncidentExerciseError("scenariet mangler et gyldigt detectedAt", "bad_detected_at");
  if (!INCIDENT_SEVERITIES.includes(scenario.severity)) throw new IncidentExerciseError(`ukendt alvorlighedsgrad '${scenario.severity}'`, "bad_severity");
  if (typeof scenario.personalDataAffected !== "boolean") throw new IncidentExerciseError("scenariet skal angive om persondata er berørt", "missing_personal_flag");

  const decision = scenario.decision ?? {};
  if (typeof decision.notifyAuthority !== "boolean" || typeof decision.notifyCustomers !== "boolean") {
    throw new IncidentExerciseError("beslutningen skal angive anmeldelse til myndighed og underretning af kunder", "incomplete_decision");
  }
  if (typeof decision.rationale !== "string" || decision.rationale.trim().length < 20) {
    throw new IncidentExerciseError("beslutningen kræver en begrundelse på mindst 20 tegn", "rationale_required");
  }
  if (!isNamedHuman(decision.decidedBy)) {
    throw new IncidentExerciseError("beslutningen skal træffes af et navngivet menneske", "human_required");
  }

  const duties = (register.incidentAndExit?.notificationDuties ?? [])
    .filter((duty) => duty.regime !== "gdpr-art33" || scenario.personalDataAffected)
    .map((duty) => {
      const deadlineAt = new Date(detected + duty.deadlineHours * 3600 * 1000).toISOString();
      const breached = decision.notifyAuthority === false;
      return {
        id: duty.id,
        regime: duty.regime,
        recipient: duty.recipient,
        owner: duty.owner,
        deadlineHours: duty.deadlineHours,
        deadlineAt,
        status: breached ? "not-notified" : "notified",
      };
    });

  return {
    kind: "BreachExerciseReport",
    exerciseId: scenario.id,
    resolvedAt: new Date(now).toISOString(),
    detectedAt: new Date(detected).toISOString(),
    severity: scenario.severity,
    personalDataAffected: scenario.personalDataAffected,
    synthetic: true,
    duties,
    decision: {
      notifyAuthority: decision.notifyAuthority,
      notifyCustomers: decision.notifyCustomers,
      rationale: decision.rationale.trim(),
      decidedBy: decision.decidedBy,
      decidedAt: new Date(now).toISOString(),
    },
    documented: true,
    note: "Deterministisk simulering. En rigtig brudøvelse og den faktiske anmeldelsesbeslutning kræver et navngivet menneske og er NOT RUN.",
  };
}

/** Semantiske problemer for en øvelsesrapport. */
export function breachExerciseProblems(report) {
  const problems = [];
  if (!report) return [{ path: "/", message: "øvelsesrapporten mangler" }];
  if (report.documented !== true) problems.push({ path: "/documented", message: "beslutningen skal være dokumenteret" });
  if (!isNamedHuman(report.decision?.decidedBy)) problems.push({ path: "/decision/decidedBy", message: "beslutningen skal være truffet af et navngivet menneske" });
  if (typeof report.decision?.rationale !== "string" || report.decision.rationale.trim().length < 20) {
    problems.push({ path: "/decision/rationale", message: "beslutningen kræver en begrundelse" });
  }
  for (const [i, duty] of (report.duties ?? []).entries()) {
    if (!["notified", "not-notified"].includes(duty.status)) problems.push({ path: `/duties/${i}/status`, message: "ukendt status" });
  }
  return problems;
}
