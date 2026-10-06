function resolvePath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * Deterministisk kontrol af at agentens strukturerede påstande matcher den
 * maskinproducerede evidens. Prosa kan ikke tjekkes — påstande med en
 * evidenceRef kan. Det er kernen i "forklaring matcher faktisk diff".
 */
export function checkClaims(request) {
  const claims = request.agentAssessment?.claims ?? [];
  const mismatches = [];
  for (const claim of claims) {
    const actual = resolvePath(request, claim.evidenceRef);
    let ok = false;
    if (claim.operator === "eq") ok = actual === claim.value;
    else if (claim.operator === "lte") ok = typeof actual === "number" && actual <= claim.value;
    else if (claim.operator === "gte") ok = typeof actual === "number" && actual >= claim.value;
    if (!ok) mismatches.push({ statement: claim.statement, evidenceRef: claim.evidenceRef, expected: claim.value, actual });
  }
  return { ok: mismatches.length === 0, claimCount: claims.length, mismatches };
}
