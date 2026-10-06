/**
 * DKC-003 — modulernes auth er nu et tynd delegat til den fælles, verificerbare
 * identitetsimplementering. Der findes ingen lokal identity-shim, og rå
 * identitetsheadere (fx x-spiffe-id) accepteres ikke.
 */
export {
  AuthError,
  createOidcAuthenticator,
  createSpiffeAuthenticator,
  createAuthenticator,
} from "../../../../identity/src/compat.mjs";
