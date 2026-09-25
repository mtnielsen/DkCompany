/**
 * DKC-013 — genoptagelig og idempotent eksekvering.
 *
 * Modulet samler:
 *   - `state.mjs` — jobtilstandsmaskinen,
 *   - `retry.mjs` — begrænsede forsøg og dead-letter-beslutning,
 *   - `classification.mjs` — read/reversibel/irreversibel klassifikation,
 *   - `queue.mjs` — den holdbare jobkø (via persistence-adapteren),
 *   - `runner.mjs` — workeren der binder kø og runtime sammen, og
 *   - `reconciler.mjs` — reconciliation og kompensation.
 */
export { JOB_STATES, TERMINAL_STATES, allowedTransitions, assertTransition, canTransition, isJobState, isTerminalState } from "./state.mjs";
export { DEFAULT_RETRY_POLICY, decideOutcome, isRetryableError, nextBackoffMs } from "./retry.mjs";
export { ACTION_CLASSES, IRREVERSIBLE_WRITES, REVERSIBLE_WRITES, classifyAction, classifyActions, classifyJob, classifyVerb, compensationFor, isIrreversibleVerb } from "./classification.mjs";
export { createJobQueue } from "./queue.mjs";
export { createJobRunner } from "./runner.mjs";
export { createJobReconciler } from "./reconciler.mjs";
