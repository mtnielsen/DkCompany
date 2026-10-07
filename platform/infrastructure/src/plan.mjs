/**
 * DKC-015 — den kanoniske infrastrukturplan for den valgte hostingprofil.
 *
 * Planen er den ene kilde for miljøer, tjenester, TLS/DNS/storage, secrets,
 * netværk, bootstrap, nøgleforvaltning og break-glass. GitOps-manifesterne og
 * den registrerede omkostning genereres fra den.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PLAN_PATH = "infrastructure/plan.json";

/** Den valgte hostingprofil for staging. */
export const HOSTING_PROFILE = "small-vps";

/** De kontroltjenester der skal kunne deployes i et miljø. */
export const REQUIRED_SERVICES = ["pdp", "audit-service", "approvals", "ai-gateway", "runtime"];

/** Moduler der ikke deployes i staging/prod og derfor undtages i GitOps-kontrollen. */
export const UNDEPLOYED_MODULES = ["dummy-ok", "mattermost-adapter", "keycloak-adapter", "nextcloud-adapter", "itsm-adapter", "openproject-adapter"];

/** Miljøer planen erklærer. `dev` er den eksisterende reference og genskabes ikke. */
export const MANAGED_ENVIRONMENTS = ["dev", "staging", "prod"];

/** Miljøer denne plan genererer GitOps-manifester for. */
export const RENDERED_ENVIRONMENTS = ["staging", "prod"];

export function loadPlan(root) {
  return JSON.parse(readFileSync(join(root, PLAN_PATH), "utf8"));
}

export function environmentById(plan, id) {
  const env = (plan.environments ?? []).find((e) => e.id === id);
  if (!env) throw new Error(`Ukendt miljø '${id}' i ${PLAN_PATH}`);
  return env;
}

export function environmentIds(plan) {
  return (plan.environments ?? []).map((e) => e.id);
}

export function deployedModules(env) {
  return (env.services ?? []).map((s) => s.module);
}

/**
 * Markør-digest for et image der endnu ikke er bygget. Den er bevidst en
 * pladsholder (ikke en rigtig hash), så release-gaten fra DKC-014 afviser den
 * indtil CI har pinnet den rigtige digest.
 */
export function pendingDigest() {
  return "0".repeat(64);
}
