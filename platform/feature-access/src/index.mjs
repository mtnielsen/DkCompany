/**
 * DKC-060 — tværgående IAM og dataadgang for Communications, HR, BI og Reporting.
 *
 * Modulet samler funktionsprofilerne, den fælles ressource-/række-/feltmotor,
 * gæste- og tjenestekontoadgang, offboarding, rapportering med revalideret
 * adgang og den beskyttede datakildeconnector. Alle dele er rene funktioner og
 * kan bruges fra conformance, en API-grænse eller et CLI.
 */
export * from "./constants.mjs";
export * from "./profiles.mjs";
export * from "./access.mjs";
export * from "./guests.mjs";
export * from "./service-accounts.mjs";
export * from "./offboarding.mjs";
export * from "./reporting.mjs";
export * from "./connector-guard.mjs";
