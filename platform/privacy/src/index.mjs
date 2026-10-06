/**
 * DKC-020 — indsigt og eksport som en tværgående, autoriseret proces.
 *
 * Modulet samler:
 *   - `identity.mjs`      — sikker identitetsmatchning og filtrering af andres data,
 *   - `authz.mjs`         — default-deny autorisation af DSAR-sagsbehandlere,
 *   - `artifact-store.mjs`— artefaktlager (persondata uden for registeret),
 *   - `export.mjs`        — sikret eksport med udløb, modtagerbinding og digest,
 *   - `case-service.mjs`  — den holdbare, genoptagelige og autoriserede sag.
 */
export {
  IdentityMatchError,
  normalizeIdentifier,
  normalizeIdentifiers,
  subjectMatch,
  filterSubjectRecords,
} from "./identity.mjs";
export {
  PrivacyAuthorizationError,
  DEFAULT_CASEWORKER_ROLES,
  DEFAULT_CASEWORKER_GROUPS,
  createCaseworkerAuthorizer,
  assertCaseworker,
} from "./authz.mjs";
export { createMemoryArtifactStore, sha256 } from "./artifact-store.mjs";
export { ExportError, createExportService } from "./export.mjs";
export { createCaseService } from "./case-service.mjs";
