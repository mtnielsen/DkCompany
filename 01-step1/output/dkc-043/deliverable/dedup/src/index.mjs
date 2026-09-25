/**
 * DKC-043 — samlet indgang til sikker deduplikering og kontrolleret oprydning.
 *
 *   - `chunker.mjs` — indholdsdefineret chunking (gear-CDC),
 *   - `keys.mjs`    — domæneafgrænsede nøgler udledt i et eksternt KMS,
 *   - `store.mjs`   — indholdsadresseret chunk-lager med referencekæde,
 *                     retention-aware GC, single-writer lease og recovery,
 *   - `backup.mjs`  — dedup/gendannelse af backupblokke oven på den
 *                     gennemprøvede backupbeholder,
 *   - `objects.mjs` — valgfri dedup af primære objekter og forbuddet mod at
 *                     flette forretningsposter,
 *   - `events.mjs`  — jobhændelser der kun deduplikeres på idempotency-nøgle,
 *   - `measure.mjs` — logiske/fysiske bytes og besparelsesgaten,
 *   - `policy.mjs`  — kanonisk politik og beslutningssemantik,
 *   - `render.mjs`  — den genererede dedup-plan.
 */
export { ChunkerError, CHUNKER_ALGORITHM, DEFAULT_CHUNKER, chunkBuffer, joinChunks, sha256Hex } from "./chunker.mjs";
export { DedupKeyError, createDedupKeyRing, createMemoryMasterKey, deriveTestKeyRing } from "./keys.mjs";
export {
  DedupError,
  DEDUP_CATEGORIES,
  normalizeDedupDomain,
  chunkIdFor,
  createDedupStore,
} from "./store.mjs";
export { snapshotIdFor, deduplicateBackup, verifyDedupedRestore, restoreDedupedBackup } from "./backup.mjs";
export {
  BusinessRecordMergeError,
  assertStorageDedupAllowed,
  planPrimaryObjectDedup,
  deduplicatePrimaryObject,
  storeBusinessRecord,
} from "./objects.mjs";
export { EventDedupError, eventDedupKey, createEventDeduper } from "./events.mjs";
export { evaluateSavingsGate, buildDedupReceipt } from "./measure.mjs";
export { DEDUP_POLICY_PATH, loadDedupPolicy, dedupPolicyProblems, dedupProviderProblems } from "./policy.mjs";
export { renderDedupPlan, DEDUP_PLAN_DOC } from "./render.mjs";
