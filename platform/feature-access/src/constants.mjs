/**
 * DKC-060 — fælles konstanter for tværgående IAM og dataadgang.
 *
 * Værdierne er delt mellem profilindlæsning, adgangsmotoren, gæste-/
 * tjenestekontoadgang, offboarding, rapportering og connector-guarden, så de
 * syv flader og de fem offboardingmål ikke kan divergere mellem moduler.
 */

/** De fire valgfrie funktionspakker. */
export const FEATURE_IDS = ["communications", "hr", "bi", "reporting"];

/**
 * De flader en autorisationsbeslutning skal håndhæves identisk på. En skjult
 * UI-knap er ikke en kontrol; UI, API, connector, søgning, eksport, cache og
 * AI-værktøj skal give samme svar.
 */
export const SURFACES = ["ui", "api", "connector", "search", "export", "cache", "ai-tool"];

/** Dataklasser for enkeltfelter. */
export const FIELD_CLASSES = ["public", "internal", "personal", "sensitive", "special-category"];

/** Klasser der ikke må læses uden en udtrykkelig regel. */
export const PROTECTED_FIELD_CLASSES = ["personal", "sensitive", "special-category"];

/** Klasser der altid kræver en eksplicit bevilling for at blive tilladt. */
export const GRANT_REQUIRED_FIELD_CLASSES = ["sensitive", "special-category"];

/** De fem rettighedsklasser offboarding skal lukke. */
export const OFFBOARDING_TARGETS = ["sessions", "api-tokens", "shares", "scheduled-workflows", "ai-tool-grants"];

/** Handlinger der er læsende på datasiderne. Alt andet kræver en separat godkendt skrivevej. */
export const READ_ACTIONS = new Set(["read", "list", "view", "search", "export", "deliver"]);
