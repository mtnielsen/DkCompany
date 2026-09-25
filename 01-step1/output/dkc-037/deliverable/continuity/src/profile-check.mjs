/**
 * DKC-037 — kompatibilitet mellem serviceklasser og deployment-profiler.
 *
 * En serviceklasse deklarerer hvilke profiler den kan køre under. Kontrollen
 * håndhæver:
 *   - en HA-profil (highAvailability.enabled) kræver mindst én HA-egnet
 *     serviceklasse, og alle klasser der peger på profilen skal være HA-egnede,
 *   - en non-HA-profil (single-server) må ikke bruge en HA-egnet klasse og
 *     kræver at nedetid er accepteret.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deploymentProfilesDir, loadServiceClasses } from "./classes.mjs";

export function loadDeploymentProfiles(dir = deploymentProfilesDir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^deployment-profile\..*\.example\.json$/.test(f))
    .sort()
    .map((file) => ({ file, path: join(dir, file), data: JSON.parse(readFileSync(join(dir, file), "utf8")) }));
}

export function checkProfileCompatibility({ profiles = loadDeploymentProfiles(), serviceClasses = loadServiceClasses() } = {}) {
  const problems = [];
  for (const profile of profiles) {
    const type = profile.data?.profileType;
    const haEnabled = profile.data?.highAvailability?.enabled === true;
    const compatible = serviceClasses.filter((sc) => (sc.data?.deploymentProfileCompatibility?.profiles ?? []).includes(type));
    if (haEnabled) {
      if (!compatible.some((sc) => sc.data?.deploymentProfileCompatibility?.haEligible === true)) {
        problems.push(`${profile.file} (${type}): HA-profil uden en HA-egnet serviceklasse`);
      }
      for (const sc of compatible) {
        if (sc.data?.deploymentProfileCompatibility?.haEligible !== true) {
          problems.push(`${sc.file}: peger på HA-profilen '${type}' men er ikke haEligible`);
        }
      }
    } else {
      for (const sc of compatible) {
        if (sc.data?.deploymentProfileCompatibility?.haEligible === true) {
          problems.push(`${sc.file}: HA-egnet klasse kan ikke køre på den non-HA profil '${type}'`);
        }
        if (sc.data?.availability?.acceptedDowntime !== true) {
          problems.push(`${sc.file}: non-HA profilen '${type}' kræver eksplicit acceptedDowntime`);
        }
      }
    }
  }
  return problems;
}

/** Kort oversigt over hvilke serviceklasser der dækker hvilke profil-typer. */
export function profileCoverage({ profiles = loadDeploymentProfiles(), serviceClasses = loadServiceClasses() } = {}) {
  return profiles.map((profile) => ({
    profile: profile.data?.profileType,
    file: profile.file,
    haEnabled: profile.data?.highAvailability?.enabled === true,
    serviceClasses: serviceClasses.filter((sc) => (sc.data?.deploymentProfileCompatibility?.profiles ?? []).includes(profile.data?.profileType)).map((sc) => sc.data.moduleRef),
  }));
}
