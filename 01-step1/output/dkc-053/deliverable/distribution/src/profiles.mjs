/**
 * DKC-053 — profilbinding og platformdækning.
 *
 * Binder installationsprofilerne til deployment-profilerne og platformmatricen:
 *   - hver profil peger på en eksisterende DKC-002 deployment-profil med samme
 *     profileType,
 *   - hver profils sikkerhedskerne er et supersæt af katalogets obligatoriske
 *     kerne,
 *   - hver reference til en valgfri applikation findes i kataloget,
 *   - hver understøttet platformskombination er navngivet og har en testkommando.
 */
import { parseVersion, compareVersions, satisfies } from "./semver.mjs";

export function findProfile(profiles, name) {
  const found = profiles.find((p) => (p.data ?? p).metadata?.name === name);
  return found ? found.data ?? found : null;
}

export function findDeploymentProfile(deploymentProfiles, ref) {
  if (!ref) return null;
  const found = deploymentProfiles.find((p) => (p.data ?? p).metadata?.name === ref || ref.endsWith(p.file));
  return found ? found.data ?? found : null;
}

/** Find platform-id for den aktuelt kørende Node-process. */
export function currentPlatformId(platforms, { platform = process.platform, arch = process.arch, nodeVersion = process.versions.node } = {}) {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  if (!parseVersion(nodeVersion)) return null;
  return platforms.find((p) => p.os === os && p.arch === arch && satisfies(nodeVersion, String(p.runtime).replace(/^node/, "")))?.id ?? null;
}

export function platformCoverageProblems(profiles, platforms) {
  const problems = [];
  const ids = new Set(platforms.map((p) => p.id));
  if (platforms.length === 0) problems.push("platformmatricen er tom");
  for (const p of platforms) {
    if (!(p.testCommand ?? "").trim()) problems.push(`platformen '${p.id}' mangler en testkommando`);
  }
  for (const profile of profiles) {
    const data = profile.data ?? profile;
    for (const id of data.supportedPlatforms ?? []) {
      if (!ids.has(id)) problems.push(`${data.metadata?.name}: understøtter den ukendte platformskombination '${id}'`);
    }
  }
  return problems;
}

export function profileBindingProblems(profiles, components, deploymentProfiles) {
  const problems = [];
  const componentIds = new Set(components.map((c) => (c.data ?? c).metadata?.name));
  const mandatoryCore = [...componentIds].filter((id) =>
    components.some((c) => (c.data ?? c).metadata?.name === id && (c.data ?? c).securityCore === true)
  );

  for (const profile of profiles) {
    const data = profile.data ?? profile;
    const name = data.metadata?.name ?? "?";
    const dp = findDeploymentProfile(deploymentProfiles, data.deploymentProfileRef);
    if (!dp) {
      problems.push(`${name}: deployment-profilen '${data.deploymentProfileRef}' findes ikke`);
    } else if (dp.profileType !== data.profileType) {
      problems.push(`${name}: profileType '${data.profileType}' matcher ikke deployment-profilens '${dp.profileType}'`);
    }
    const core = new Set(data.securityCore ?? []);
    for (const id of mandatoryCore) {
      if (!core.has(id)) problems.push(`${name}: sikkerhedskernen mangler den obligatoriske komponent '${id}'`);
    }
    for (const id of [...core, ...(data.defaultApplications ?? []), ...(data.optionalApplications ?? [])]) {
      if (!componentIds.has(id)) problems.push(`${name}: refererer til den ukendte komponent '${id}'`);
    }
    const host = data.hostManagement?.component;
    if (host && !componentIds.has(host)) problems.push(`${name}: host-styringskomponenten '${host}' findes ikke`);
  }
  return problems;
}

/** Højeste produktversion for en komponent på tværs af kataloget. */
export function newestComponentVersion(components, id) {
  const versions = components.map((c) => c.data ?? c).filter((c) => c.metadata?.name === id).map((c) => c.metadata.version);
  return versions.sort(compareVersions).at(-1) ?? null;
}
