/**
 * DKC-031 — dækningsmatrix.
 *
 * For hver pilotapp, entitetstype og facet (ejerskab, timestamps, kommentarer,
 * bilag, ACL og links) beregnes en status: `full`, `partial` eller
 * `unsupported`. Enhver ikke-fuld facet havner i `lostFunctionality`, så tabt
 * funktionalitet kan vises **før** cutover. Matricen udledes af de erklærede
 * kilder, så den ikke kan komme ud af trit med dem.
 */
import { COVERAGE_FACETS } from "./model.mjs";

export function buildCoverage({ sources, at = "2026-03-01T00:00:00Z" } = {}) {
  const matrix = [];
  const lostFunctionality = [];
  const summary = { full: 0, partial: 0, unsupported: 0 };
  for (const source of sources?.sources ?? []) {
    for (const entityType of source.entityTypes ?? []) {
      const facets = source.facets?.[entityType] ?? {};
      for (const facet of COVERAGE_FACETS) {
        const entry = facets[facet] ?? { status: "unsupported", note: "facetten er ikke erklæret" };
        matrix.push({
          appId: source.appId,
          tenantId: source.tenantId,
          entityType,
          facet,
          status: entry.status,
          source: entry.source ?? null,
          target: entry.target ?? null,
          note: entry.note ?? null,
        });
        summary[entry.status] = (summary[entry.status] ?? 0) + 1;
        if (entry.status !== "full") {
          lostFunctionality.push({
            appId: source.appId,
            tenantId: source.tenantId,
            entityType,
            facet,
            status: entry.status,
            note: entry.note ?? null,
          });
        }
      }
    }
  }
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationCoverage",
    generatedAt: at,
    matrix: matrix.sort((a, b) => `${a.appId}:${a.entityType}:${a.facet}`.localeCompare(`${b.appId}:${b.entityType}:${b.facet}`)),
    lostFunctionality: lostFunctionality.sort((a, b) => `${a.appId}:${a.entityType}:${a.facet}`.localeCompare(`${b.appId}:${b.entityType}:${b.facet}`)),
    summary,
  };
}

/** Tabt funktionalitet for ét app-par, klar til cutover-rapporten. */
export function lostFunctionalityFor(coverage, appId) {
  return (coverage?.lostFunctionality ?? []).filter((entry) => entry.appId === appId);
}
