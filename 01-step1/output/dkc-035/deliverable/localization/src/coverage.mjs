/**
 * DKC-035 — dækningsmatrix for dansk lokalisering.
 *
 * For hver familie og hvert lokaliseringskrav beregnes en status: `full`
 * (bekræftet eller eksplicit ikke-anvendeligt), `partial` (afventer en
 * afgørelse) eller `unsupported` (ikke undersøgt). Matricen udledes af
 * kataloget, så den ikke kan komme ud af trit med kravene. Regnskab og løn kan
 * ikke blive 'full' alene på baggrund af upstream-features.
 */
export function buildCoverageMatrix(families, requirements) {
  const matrix = [];
  for (const family of families?.families ?? []) {
    for (const reqId of family.localeRequirements ?? []) {
      const req = (requirements?.requirements ?? []).find((r) => r.id === reqId);
      if (!req) continue;
      const status = req.status === "confirmed" || req.status === "not-applicable" ? "full" : req.status === "pending" ? "partial" : "unsupported";
      matrix.push({
        family: family.id,
        requirement: reqId,
        status,
        reviewStatus: req.status,
        blocksDanishReady: req.gate?.blocksDanishReady === true,
      });
    }
  }
  return matrix.sort((a, b) => a.family.localeCompare(b.family) || a.requirement.localeCompare(b.requirement));
}

export function coverageSummary(matrix) {
  const summary = { full: 0, partial: 0, unsupported: 0 };
  for (const entry of matrix) summary[entry.status] = (summary[entry.status] ?? 0) + 1;
  return summary;
}
