/**
 * DKC-036 — resolver-integration for enterprise- og branchepakker.
 *
 * Hver pakke løses gennem den eksisterende dependency-resolver (DKC-053) mod
 * den størrelsesprofil, pakken bygger på. Derefter kontrolleres pakkens
 * kapabilitetskrav mod den valgte closure: en påkrævet kapabilitet skal være
 * til stede, og en forbudt kapabilitet må ikke være det. En pakke kan ikke
 * forke kontrolplanet, fordi kontrolplans-kapabiliteterne skal komme fra
 * størrelsesprofilens sikkerhedskerne.
 */
import { loadComponents, loadProfiles, loadDeploymentProfiles } from "../../distribution/src/catalog.mjs";
import { resolveDependencies } from "../../distribution/src/resolver.mjs";
import { findDeploymentProfile } from "../../distribution/src/profiles.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

export function resolveEnterprisePackage(pkg, options = {}) {
  const {
    components = loadComponents(),
    profiles = loadProfiles(),
    deploymentProfiles = loadDeploymentProfiles(),
    serviceClasses = loadServiceClasses(),
    capabilityCatalog = null,
  } = options;

  const profileEntry = profiles.find((p) => (p.data ?? p).metadata?.name === pkg.baseProfileRef);
  if (!profileEntry) {
    return { ok: false, code: "UNKNOWN_BASE_PROFILE", errors: [`størrelsesprofilen '${pkg.baseProfileRef}' findes ikke`], closure: [], capabilities: [] };
  }
  const profile = profileEntry.data ?? profileEntry;
  const deploymentProfile = findDeploymentProfile(deploymentProfiles, profile.deploymentProfileRef);
  const resolution = resolveDependencies({
    components,
    profile,
    selection: pkg.apps ?? [],
    deploymentProfile,
    serviceClasses,
  });

  const byName = new Map(components.map((entry) => [entry.data.metadata.name, entry.data]));
  const capabilities = new Set();
  for (const id of resolution.closure) {
    for (const cap of byName.get(id)?.provides?.capabilities ?? []) capabilities.add(cap);
  }

  const required = pkg.capabilityConstraints?.required ?? [];
  const forbidden = pkg.capabilityConstraints?.forbidden ?? [];
  const controlPlane = pkg.capabilityConstraints?.controlPlane ?? [];
  const capById = new Map((capabilityCatalog?.capabilities ?? []).map((c) => [c.id, c]));

  const errors = [];
  for (const id of required) {
    if (!capabilities.has(id)) {
      const known = capById.has(id);
      errors.push(`${known ? "MISSING_CAPABILITY" : "UNSUPPORTED_CAPABILITY"}: den påkrævede kapabilitet '${id}' ${known ? `findes i registeret, men udbydes ikke af closuren for '${pkg.baseProfileRef}'` : "findes ikke i kapabilitetsregisteret"}`);
    }
  }
  for (const id of forbidden) {
    if (capabilities.has(id)) errors.push(`FORBIDDEN_CAPABILITY: den forbudte kapabilitet '${id}' er til stede i closuren`);
  }
  for (const id of controlPlane) {
    const cap = capById.get(id);
    if (!cap) continue;
    const providers = new Set(cap.providedBy ?? []);
    const present = [...providers].some((ref) => resolution.closure.includes(ref));
    if (!present) errors.push(`MISSING_CONTROL_PLANE: kontrolplans-kapabiliteten '${id}' mangler i closuren`);
    const core = new Set(profile.securityCore ?? []);
    const fromCore = [...providers].every((ref) => core.has(ref));
    if (!fromCore) errors.push(`CONTROL_PLANE_FORK: kontrolplans-kapabiliteten '${id}' arves ikke fra størrelsesprofilens sikkerhedskerne`);
  }
  for (const e of resolution.errors) errors.push(`${e.code}: ${e.message}`);
  for (const e of resolution.safety.errors) errors.push(`${e.code}: ${e.message}`);

  return {
    ok: errors.length === 0 && resolution.ok && resolution.safety.ok,
    errors,
    profile: profile.metadata?.name,
    closure: resolution.closure,
    capabilities: [...capabilities].sort(),
    required,
    forbidden,
    controlPlane,
    resolution: {
      resources: resolution.resources,
      downloadTotalMiB: resolution.downloadTotalMiB,
      order: resolution.order,
    },
  };
}
