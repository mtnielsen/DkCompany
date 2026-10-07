/**
 * DKC-055 — præcis én uforanderlig rolle pr. agent gennem hele workflowet.
 */
export {
  ROLES,
  FORBIDDEN_AI_ROLES,
  READ_VERBS,
  CHECK_VERBS,
  PROPOSE_VERBS,
  EXECUTE_VERBS,
  ROLE_VERBS,
  ROLE_PRODUCES,
  ROLE_CONSUMES,
  ROLE_TOOLS,
  HANDOFF_RULES,
  DEPLOY_ROLES,
  isRole,
  isForbiddenAiRole,
  roleAllowsVerb,
  roleMayProduce,
  roleMayConsume,
  roleMayDeploy,
  roleMayApprove,
  roleAllowedVerbs,
  roleAllowedTools,
  roleAllowedArtifacts,
  handoffRule,
  validateRoleManifest,
} from "./roles.mjs";
export { AgentRegistryError, PLATFORM_ADMIN_ROLES, assertHumanAuthority, createAgentRegistry } from "./registry.mjs";
export {
  HandoffError,
  createHandoff,
  verifyHandoff,
  assertIndependentVerification,
  createChangeApprovalBinding,
  verifyChangeApprovalBinding,
} from "./handoff.mjs";
export { createScheduler } from "./scheduler.mjs";
export { guardRoleAction, guardIndependentVerification } from "./runtime-role-guard.mjs";
