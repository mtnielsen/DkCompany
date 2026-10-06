/**
 * DKC-035 — integration mod den faktiske resolver og adapterkontrakt.
 *
 * Hver familie løses gennem den eksisterende dependency-resolver (DKC-053) mod
 * en konkret installationsprofil, så et katalogmanifest ikke kan registreres uden
 * at kunne resolveres. Adaptergrænsefladen kontrolleres mod modulets erklærede
 * driftsverber og dataklasser.
 */
import { loadComponents, loadProfiles, loadDeploymentProfiles } from "../../distribution/src/catalog.mjs";
import { resolveDependencies } from "../../distribution/src/resolver.mjs";
import { findDeploymentProfile } from "../../distribution/src/profiles.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

export function resolveFamilyComponents(family, { profileName = "enterprise-dedicated", components = null, profiles = null, deploymentProfiles = null, serviceClasses = null } = {}) {
  const allComponents = components ?? loadComponents();
  const allProfiles = profiles ?? loadProfiles();
  const profile = allProfiles.find((p) => p.data.metadata.name === profileName) ?? allProfiles[0];
  const allDeployment = deploymentProfiles ?? loadDeploymentProfiles();
  const deploymentProfile = findDeploymentProfile(allDeployment, profile.data.deploymentProfileRef);
  const classes = serviceClasses ?? loadServiceClasses();
  const result = resolveDependencies({ components: allComponents, profile: profile.data, selection: family.components, deploymentProfile, serviceClasses: classes });
  return {
    family: family.id,
    profile: profile.data.metadata.name,
    ok: result.ok && result.safety.ok,
    closure: result.closure,
    errors: [...result.errors.map((e) => e.code), ...result.safety.errors.map((e) => e.code)],
    dataServices: result.dataServices.map((d) => `${d.id}|${d.kind}`).sort(),
  };
}

/** Kontrollér at adaptergrænsefladen dækker modulets driftsverber og dataklasser. */
export function checkAdapterInterface(iface, manifest) {
  const problems = [];
  if (!iface) return [`adaptergrænsefladen mangler for '${manifest?.metadata?.name ?? "?"}'`];
  const verbs = new Set(iface.verbs ?? []);
  for (const op of manifest?.operations ?? []) {
    if (!verbs.has(op)) problems.push(`adaptergrænsefladen '${iface.id}' mangler driftsverbet '${op}'`);
  }
  const classes = new Set(iface.dataClasses ?? []);
  for (const dc of manifest?.localization?.dataClasses ?? []) {
    if (!classes.has(dc)) problems.push(`adaptergrænsefladen '${iface.id}' dækker ikke dataklassen '${dc}'`);
  }
  return problems;
}
