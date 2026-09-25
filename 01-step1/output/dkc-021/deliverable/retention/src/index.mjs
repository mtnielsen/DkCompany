/**
 * DKC-021 — offentligt interface for retention-modulet.
 */
export { deletionPolicyProblems, surfaceById, surfacesCovering, REQUIRED_SURFACE_KINDS } from "./policy.mjs";
export { HoldError, subjectDigestOf, legalHoldProblems, holdCovers, buildHold, createMemoryRetentionStore } from "./holds.mjs";
export { createDerivedAiStore, DerivedAiError } from "./derived-ai.mjs";
export { subjectDigest, buildIntentPayload, buildOutcomePayload, assertRedacted, createMemoryAuditTrail } from "./audit.mjs";
export {
  createObjectStoreSurface,
  createIndexSurface,
  createCacheSurface,
  createDerivedAiSurface,
  createBackupSurface,
  createUpstreamSurface,
  buildSurfaces,
} from "./surfaces.mjs";
export { DeletionError, createDeletionService } from "./deletion-service.mjs";
export { RestoreGateError, createQuarantineWorkspace, createRestoreReleaseGate } from "./restore-gate.mjs";
export { loadPolicy, loadCommittedExample, policyProblems, policyPath, examplePath, repoRoot } from "./registry.mjs";
export { renderMarkdown } from "./render.mjs";
