/**
 * DKC-049 — adskilt provenance.
 *
 * Et logforløb blander tre grundlæggende ting, der ikke må forveksles:
 *   - **sensor** — en målt observation (metrics, logs, traces, scanners),
 *   - **model** — et modeludsagn (leverandør, modelversion, promptversion,
 *     beslutningsresumé),
 *   - **verified** — et verificeret resultat med en uafhængig digest.
 *
 * Derudover findes `human` (en menneskebeslutning) og `system` (platformens
 * egen hændelse). Hver post har præcis én provenance og præcis den tilhørende
 * blok. Dermed kan et modeludsagn aldrig læses som et verificeret resultat, og
 * en sensorobservation kan ikke overskrives af modeltekst.
 */
export const PROVENANCE_CLASSES = ["sensor", "model", "verified", "human", "system"];

/** Den blok hver provenance SKAL bære. */
export const PROVENANCE_BLOCK = {
  sensor: "observation",
  system: "observation",
  model: "model",
  verified: "verification",
  human: "human",
};

/** Alle blokke der udtrykker en provenance (må ikke blandes). */
export const PROVENANCE_BLOCKS = ["observation", "model", "verification", "human"];

export function provenanceProblems(record) {
  const problems = [];
  const provenance = record?.provenance;
  if (!PROVENANCE_CLASSES.includes(provenance)) {
    problems.push({ path: "/provenance", message: `ukendt provenance '${provenance}' (forventer ${PROVENANCE_CLASSES.join(", ")})` });
    return problems;
  }
  const expected = PROVENANCE_BLOCK[provenance];
  if (!record[expected] || typeof record[expected] !== "object") {
    problems.push({ path: `/${expected}`, message: `provenance '${provenance}' kræver en '${expected}'-blok` });
  }
  for (const block of PROVENANCE_BLOCKS) {
    if (block === expected) continue;
    if (record[block] !== undefined) {
      problems.push({ path: `/${block}`, message: `'${block}' må ikke blandes ind i en '${provenance}'-post` });
    }
  }
  return problems;
}

/** Den primære provenance-blok for en post (eller null). */
export function provenanceBlock(record) {
  const block = PROVENANCE_BLOCK[record?.provenance];
  return block ? record[block] : null;
}
