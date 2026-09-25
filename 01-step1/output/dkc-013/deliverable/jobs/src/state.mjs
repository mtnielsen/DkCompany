/**
 * DKC-013 — jobtilstandsmaskine.
 *
 * En jobtilstand må kun ændre sig ad de kanter der er tilladte her. Det gør
 * "genstart midt i et job" til en eksplicit overgang (`leased`/`running` →
 * `queued` efter en udløbet lease) i stedet for et implicit tab, og det gør et
 * `unknown` til en tilstand der skal reconcileres — ikke genudføres.
 */
export const JOB_STATES = ["queued", "leased", "running", "retry-scheduled", "unknown", "completed", "failed", "dead-letter", "cancelled"];

export const TERMINAL_STATES = new Set(["completed", "failed", "dead-letter", "cancelled"]);

const TRANSITIONS = {
  queued: ["leased", "cancelled"],
  leased: ["running", "queued", "retry-scheduled", "dead-letter", "cancelled"],
  running: ["completed", "failed", "unknown", "retry-scheduled", "dead-letter", "cancelled"],
  "retry-scheduled": ["queued", "leased", "dead-letter", "cancelled"],
  unknown: ["completed", "failed", "dead-letter", "cancelled", "queued"],
  completed: [],
  failed: [],
  "dead-letter": ["queued"],
  cancelled: [],
};

export function isJobState(state) {
  return JOB_STATES.includes(state);
}

export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from, to) {
  if (!isJobState(from)) throw new Error(`ukendt jobtilstand '${from}'`);
  if (!isJobState(to)) throw new Error(`ukendt jobtilstand '${to}'`);
  if (!canTransition(from, to)) throw new Error(`ulovlig jobtilstandsovergang '${from}' → '${to}'`);
  return true;
}

export function allowedTransitions(from) {
  return [...(TRANSITIONS[from] ?? [])];
}
