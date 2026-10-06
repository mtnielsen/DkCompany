/**
 * DKC-024 — fælles demo-identitetsværn.
 *
 * En demo-shim findes kun for at kunne udvikle og teste uden en rigtig IdP.
 * Den må aldrig give adgang i produktion, uanset hvordan den kommer ind:
 * en header, en fejlkonfigureret authenticator eller en kompromitteret
 * proxy. `identity/src/compat.mjs` nægter allerede at *konstruere* en
 * demo-shim uden for testprofilen. Dette værn er det uafhængige andet lag i
 * selve verbumskæden, så en authenticator der alligevel udsteder
 * `principal.demo === true` bliver afvist, før tenant, PDP eller handler ser
 * principalen.
 *
 * Værnet er bevidst en ren funktion uden afhængigheder, så både SDK'en og de
 * adaptere der endnu ikke er flyttet over på SDK'en kan bruge præcis samme
 * beslutning.
 */
export const DEMO_PROFILE = "test";

/** Sand hvis principalen må passere i den givne profil. */
export function demoPrincipalAllowed(principal, { profile = "production" } = {}) {
  return !(principal?.demo === true && profile !== DEMO_PROFILE);
}

/** Stabil, menneskelæsbar begrundelse til audit og API-svar. */
export function demoForbiddenReason(principal, { profile = "production" } = {}) {
  return `demo-identitet '${principal?.id ?? "?"}' giver ikke adgang i profil '${profile}'`;
}

/** Fejlkode der kan mappes til HTTP 401. */
export const DEMO_FORBIDDEN_CODE = "demo_forbidden";
