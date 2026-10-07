/**
 * DKC-021 — redaktion af slette-revisionssporet.
 *
 * Et slettebevis skal kunne dokumentere *at* sletningen skete, for hvem
 * (subjektets digest), hvilke flader der blev dækket, og hvad resultatet var.
 * Det må aldrig indeholde de slettede data eller rå identifikatorer. Denne modul
 * er den ene vej fra en anmodning til et sikkert revisionspayload.
 */
import { createHash } from "node:crypto";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}

/** SHA-256 over den kanoniserede subjektnøgle. */
export function subjectDigest(subjectKey) {
  return createHash("sha256").update(canonical(subjectKey)).digest("hex");
}

/**
 * Byg et minimalt, sikkert intent-payload. Kun digest, dataklasser og
 * flade-id'er — ingen fri tekst fra subjektet.
 */
export function buildIntentPayload({ subjectDigest: digest, dataClasses = [], surfaces = [], reason = "dsar-erasure" } = {}) {
  return {
    subjectDigest: digest,
    dataClasses: [...new Set(dataClasses)].sort(),
    surfaces: [...surfaces].map((s) => s.id ?? s).sort(),
    reason,
  };
}

/**
 * Byg et sikkert outcome-payload ud fra resultaterne. Det indeholder status og
 * antal, ikke de slettede rækker.
 */
export function buildOutcomePayload({ status, results = [], remainingCopies = [] } = {}) {
  return {
    status,
    results: results
      .map((r) => ({ surface: r.surface, status: r.status, recordsAffected: r.recordsAffected, remainingCopies: (r.remainingCopies ?? []).length }))
      .sort((a, b) => a.surface.localeCompare(b.surface)),
    remainingCopies: remainingCopies.length,
  };
}

/** Felter der aldrig må stå i et slette-revisionsspor. */
export const FORBIDDEN_AUDIT_KEYS = new Set(["email", "phone", "name", "subject", "subjectKey", "identifiers", "ssn", "cpr", "payload", "value", "records"]);

/**
 * Minimal, holdbar-i-hukommelsen revisionsspor til CLI, demo og tests. Den
 * rigtige, vedvarende log er `persistence` audit-journalen; interfacet
 * (`begin`/`complete`) er det samme.
 */
export function createMemoryAuditTrail({ clock = () => Date.now() } = {}) {
  const intents = [];
  const outcomes = [];
  let seq = 0;
  return {
    kind: "memory-audit-trail",
    intents: () => structuredClone(intents),
    outcomes: () => structuredClone(outcomes),
    begin(intent) {
      const problems = assertRedacted(intent);
      if (problems.length) throw new Error(`revisionsintentet indeholder rå identifikatorer: ${problems.join("; ")}`);
      seq += 1;
      const record = { intentId: `intent-${seq}`, at: new Date(clock()).toISOString(), ...intent };
      intents.push(record);
      return record;
    },
    complete(intentId, outcome) {
      const problems = assertRedacted(outcome);
      if (problems.length) throw new Error(`revisionsudfaldet indeholder rå identifikatorer: ${problems.join("; ")}`);
      const record = { outcomeId: `outcome-${seq}`, intentId, at: new Date(clock()).toISOString(), ...outcome };
      outcomes.push(record);
      return record;
    },
  };
}

/**
 * Fail-closed kontrol: afvis et payload der bærer rå identifikatorer eller
 * slettede data. Bruges før noget skrives til den vedvarende log.
 */
export function assertRedacted(payload, path = "") {
  const problems = [];
  const walk = (node, nodePath) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${nodePath}/${i}`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const childPath = `${nodePath}/${key}`;
      if (FORBIDDEN_AUDIT_KEYS.has(key)) problems.push(`${childPath} er en rå identifikator og må ikke logges`);
      walk(value, childPath);
    }
  };
  walk(payload, path);
  return problems;
}
