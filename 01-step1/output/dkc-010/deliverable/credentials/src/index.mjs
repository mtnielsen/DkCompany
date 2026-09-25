/**
 * DKC-010 — kortlivede, scope-bundne rettigheder og nødstop.
 *
 * Samlet indgang:
 *   - `keys.mjs`      — KMS-/signerer-abstraktion (Ed25519) og JWKS
 *   - `jws.mjs`       — kompakt JWS-signering/verifikation
 *   - `scope.mjs`     — kunde/ressource/verbum/miljø/audience-binding
 *   - `broker.mjs`    — udstedelse (kræver signerer)
 *   - `verifier.mjs`  — modtagerverifikation (kræver kun offentlig nøgle)
 *   - `receiver.mjs`  — executor-vagt
 *   - `revocation.mjs`— tilbagekaldelse pr. credential/agent/kunde
 *   - `kill-switch.mjs`— nødstop pr. agent/kunde/globalt
 */
export { generateSigningKey, createLocalSigner, signerFromPrivateJwk, assertSigner, verifySignature, signersToJwks, keyResolverFromJwks } from "./keys.mjs";
export { signJws, verifyJws, decodeJws, base64url } from "./jws.mjs";
export { AUDIENCE_PREFIX, ScopeError, deriveAudience, assertIssuableScope, resourceWithin, scopeAllows } from "./scope.mjs";
export { createCredentialBroker, CredentialBrokerError, DEFAULT_TTL_SECONDS } from "./broker.mjs";
export { createCredentialVerifier } from "./verifier.mjs";
export { createExecutorGuard, CredentialRejected } from "./receiver.mjs";
export { createRevocationList } from "./revocation.mjs";
export { createKillSwitch, EmergencyStopActive, EmergencyStopAuthorityError, KILL_SWITCH_SCOPES, KILL_SWITCH_AUTHORITY } from "./kill-switch.mjs";
