/**
 * DKC-061 — cloud-uafhængig drift, internetudfald og offlinepakke.
 *
 * Offlineberedskabet er en ren funktion over offlinepakken og gateway-ruterne.
 * Det viser hvilke lokale kerneflows der fortsætter uden internet, og hvilke
 * eksterne afhængigheder der bliver utilgængelige — altid med en eksplicit
 * status. Der findes ingen tavs fallback: en ikke-understøttet ekstern funktion
 * skal vises tydeligt.
 */

export const OFFLINE_API_VERSION = "contracts.platform/v1alpha1";
export const OFFLINE_KIND = "OfflineReadiness";

/** Status for hver ekstern afhængighed ved et internetudfald. */
export function offlineDependencyStatuses(pkg, { online = false } = {}) {
  const statuses = [];
  for (const dep of pkg?.externalDependencies ?? []) {
    const available = online === true;
    let status;
    let message;
    if (available) {
      status = "available";
      message = `${dep.id} er tilgængelig.`;
    } else {
      switch (dep.offlineBehavior) {
        case "local-fallback":
          status = "degraded-local";
          message = dep.explicitStatus;
          break;
        case "read-only-cache":
          status = "read-only";
          message = dep.explicitStatus;
          break;
        case "queued":
          status = "queued";
          message = dep.explicitStatus;
          break;
        default:
          status = "unavailable-visible";
          message = dep.explicitStatus;
          break;
      }
    }
    statuses.push({ id: dep.id, kind: dep.kind, status, available, offlineBehavior: dep.offlineBehavior, affectedFeatures: [...(dep.affectedFeatures ?? [])].sort(), localFallbackRef: dep.localFallbackRef ?? null, message, routeRefs: [...(dep.routeRefs ?? [])].sort() });
  }
  return statuses.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Beregn offlineberedskabet. Lokale kerneflows består; eksterne afhængigheder
 * vises som utilgængelige/degraderede med en eksplicit status, og der må ikke
 * være en tavs fallback.
 */
export function offlineReadiness(pkg, { online = false } = {}) {
  const problems = [];
  const statuses = offlineDependencyStatuses(pkg, { online });
  const localFlows = (pkg?.coreFlows ?? []).filter((f) => f.local === true).map((f) => f.id).sort();
  if (!localFlows.length) problems.push("offlinepakken har ingen lokale kerneflows");
  for (const dep of pkg?.externalDependencies ?? []) {
    if (!(dep.explicitStatus ?? "").trim()) problems.push(`den eksterne afhængighed '${dep.id}' mangler en eksplicit status`);
    if (dep.offlineBehavior === "local-fallback" && !(dep.localFallbackRef ?? "").trim()) problems.push(`afhængigheden '${dep.id}' mangler en lokal fallback`);
  }
  const unavailable = statuses.filter((s) => !s.available);
  const visible = unavailable.every((s) => s.message && s.message.trim().length > 0);
  if (!visible) problems.push("en utilgængelig ekstern funktion vises ikke tydeligt");
  return {
    apiVersion: OFFLINE_API_VERSION,
    kind: OFFLINE_KIND,
    online: online === true,
    localFlows,
    coreFlowsRemainLocal: (pkg?.policy?.coreFlowsRemainLocal ?? false) && localFlows.length > 0,
    external: statuses,
    affectedFeatures: [...new Set(unavailable.flatMap((s) => s.affectedFeatures))].sort(),
    noSilentFallback: pkg?.policy?.noSilentFallback === true,
    problems,
  };
}

/** Hvorvidt et givet lokalt kerneflow består ved et udfald. */
export function coreFlowPreserved(pkg, flowId, { online = false } = {}) {
  const flow = (pkg?.coreFlows ?? []).find((f) => f.id === flowId);
  if (!flow) return { flowId, known: false, preserved: false };
  const ready = offlineReadiness(pkg, { online });
  return { flowId, known: true, local: flow.local === true, preserved: flow.local === true, blockedBy: flow.externalDependencies ?? [], readinessProblems: ready.problems };
}
