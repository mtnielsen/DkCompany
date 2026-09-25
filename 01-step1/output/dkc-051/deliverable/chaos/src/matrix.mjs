/**
 * DKC-051 — semantik for fejl- og katastrofematrixen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - matrixen skal have et navngivet menneske som ejer og et gennemgangsdato,
 *   - invarianten "ingen split-brain", "ingen tab af kvitterede writes",
 *     "immutable-bypass afvises og logges", "healingstorm er afgrænset" og
 *     "kan gentages fra ren installation" skal alle være sande,
 *   - hvert scenarie skal erklære failure scope, forventet dataudfald, RPO/RTO,
 *     tilladt autonomi og en konkret probe, og
 *   - en model må ikke erklære en målt øvelse.
 *
 * Modellen erstatter ikke en målt fejløvelse på en levende klynge.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const FAILURE_MATRIX_PATH = "chaos/failure-matrix.json";
export const CHAOS_REPORT_PATH = "chaos/report/chaos-report.json";
export const CHAOS_DOC_PATH = "docs/continuity/chaos-report.md";

export const INVARIANTS = ["noSplitBrain", "noLostAcknowledgedWrites", "immutableBypassDeniedAndLogged", "healingStormBounded", "repeatableFromCleanInstall"];
export const FAILURE_SCOPES = ["single-host", "quorum", "network-partition", "database", "storage", "queue", "control-plane", "site", "keys", "immutable", "deduplication"];
export const DATA_OUTCOMES = ["no-loss", "no-acknowledged-loss", "bounded-loss"];
export const AUTONOMY = ["none", "safe-fallback", "runbook-with-approval"];

function err(path, message) {
  return { path, message };
}

export function loadFailureMatrix(root) {
  return JSON.parse(readFileSync(join(root, FAILURE_MATRIX_PATH), "utf8"));
}

export function scenarioById(matrix, id) {
  return (matrix.scenarios ?? []).find((s) => s.id === id);
}

export function failureMatrixProblems(matrix) {
  const problems = [];
  if (!matrix || typeof matrix !== "object") return [err("/", "fejlmatrixen er ikke et objekt")];
  if (!isNamedHuman(matrix.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "fejlmatrixen skal have et navngivet menneske som ejer"));
  }
  if (!(matrix.metadata?.lastReviewed ?? "").trim()) problems.push(err("/metadata/lastReviewed", "fejlmatrixen skal have en gennemgangsdato"));
  if (!(matrix.principle ?? "").trim()) problems.push(err("/principle", "fejlmatrixen skal erklære sit princip"));

  for (const invariant of INVARIANTS) {
    if (matrix.invariants?.[invariant] !== true) problems.push(err(`/invariants/${invariant}`, `invarianten '${invariant}' skal være sand`));
  }

  const scenarios = matrix.scenarios ?? [];
  if (scenarios.length < 10) problems.push(err("/scenarios", "fejlmatrixen skal have mindst ti scenarier"));
  const ids = new Set();
  const scopes = new Set();
  for (const [i, scenario] of scenarios.entries()) {
    const at = `/scenarios/${i}`;
    if (ids.has(scenario.id)) problems.push(err(`${at}/id`, `scenariet '${scenario.id}' er erklæret flere gange`));
    ids.add(scenario.id);
    scopes.add(scenario.failureScope);
    if (!FAILURE_SCOPES.includes(scenario.failureScope)) problems.push(err(`${at}/failureScope`, `scenariet '${scenario.id}' har et ukendt failure scope`));
    if (!DATA_OUTCOMES.includes(scenario.expectedDataOutcome)) problems.push(err(`${at}/expectedDataOutcome`, `scenariet '${scenario.id}' har et ukendt dataudfald`));
    if (!AUTONOMY.includes(scenario.allowedAutonomy)) problems.push(err(`${at}/allowedAutonomy`, `scenariet '${scenario.id}' har en ukendt autonomi`));
    if (!Number.isInteger(scenario.rpoMinutes) || scenario.rpoMinutes < 0) problems.push(err(`${at}/rpoMinutes`, `scenariet '${scenario.id}' mangler en gyldig RPO`));
    if (!Number.isInteger(scenario.rtoMinutes) || scenario.rtoMinutes < 1) problems.push(err(`${at}/rtoMinutes`, `scenariet '${scenario.id}' mangler en gyldig RTO`));
    if (!(scenario.probe ?? "").trim()) problems.push(err(`${at}/probe`, `scenariet '${scenario.id}' mangler en probe`));
    if (!Array.isArray(scenario.probesInvariants) || scenario.probesInvariants.length === 0) {
      problems.push(err(`${at}/probesInvariants`, `scenariet '${scenario.id}' skal pege på mindst én invariant`));
    } else {
      for (const invariant of scenario.probesInvariants) {
        if (!INVARIANTS.includes(invariant)) problems.push(err(`${at}/probesInvariants`, `scenariet '${scenario.id}' peger på den ukendte invariant '${invariant}'`));
      }
    }
    if (scenario.probesInvariants.includes("healingStormBounded") && scenario.sharedHealingBudget !== true) {
      problems.push(err(`${at}/sharedHealingBudget`, `scenariet '${scenario.id}' probet healingstorm skal dele et fælles healingbudget`));
    }
  }

  // De kritiske scopes skal være dækket.
  for (const required of ["single-host", "quorum", "network-partition", "database", "storage", "queue", "control-plane", "site", "keys", "immutable", "deduplication"]) {
    if (!scopes.has(required)) problems.push(err("/scenarios", `fejlmatrixen mangler et scenarie med failure scope '${required}'`));
  }

  const measurement = matrix.measurement ?? {};
  if (measurement.mode !== "deterministic-simulation" || measurement.measured !== false) {
    problems.push(err("/measurement", "matrixen må ikke erklære en målt øvelse"));
  }
  if (measurement.requiresLiveStaging !== true) problems.push(err("/measurement/requiresLiveStaging", "en levende staging-øvelse skal markeres som påkrævet"));
  if (!(matrix.liveEvidenceRef ?? "").trim()) problems.push(err("/liveEvidenceRef", "den levende øvelses evidensreference mangler"));

  return problems;
}
