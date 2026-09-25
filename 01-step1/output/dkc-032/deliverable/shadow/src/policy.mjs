/**
 * DKC-032 — indlæsning og semantik for autonomibevillingen og replay-datasættet.
 *
 * Skemaet håndhæver formen (se `contracts/autonomy-grant.schema.json`). Denne
 * modul håndhæver beslutningerne: et navngivet menneske som ejer, en
 * versionsstyret historik, gentaget evaluering på et bundet
 * model-/promptfingeraftryk, staging-only for begrænset autonomi og ingen
 * irreversible verber i scopet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTONOMY_LEVELS, EXECUTING_LEVEL, isAtLeast, isNamedHuman, modelFingerprint, SIGNAL_PROPOSALS } from "./shadow.mjs";
import { isIrreversibleVerb } from "../../runtime/src/classification.mjs";

export const AUTONOMY_POLICY_PATH = "shadow/autonomy-policy.json";
export const REPLAY_DATASET_PATH = "shadow/replay-dataset.json";
export const REPORT_PATH = "shadow/report/shadow-report.json";
export const REPORT_DOC_PATH = "docs/ai-operations/shadow-report.md";
export const LIVE_DOC_PATH = "docs/ai-operations/shadow-live.md";

function err(path, message) {
  return { path, message };
}

export function loadAutonomyPolicy(root) {
  return JSON.parse(readFileSync(join(root, AUTONOMY_POLICY_PATH), "utf8"));
}

export function loadReplayDataset(root) {
  return JSON.parse(readFileSync(join(root, REPLAY_DATASET_PATH), "utf8"));
}

/** Semantiske beslutninger for den versionsstyrede ejerbeslutning. */
export function autonomyPolicyProblems(grant) {
  const problems = [];
  if (!grant || typeof grant !== "object") return [err("/", "autonomibevillingen er ikke et objekt")];
  if (grant.kind !== "AutonomyGrant") problems.push(err("/kind", "bevillingen skal være af typen AutonomyGrant"));
  if (!isNamedHuman(grant.owner)) problems.push(err("/owner", "bevillingen skal have et navngivet menneske som ejer"));
  if (!AUTONOMY_LEVELS.includes(grant.level)) problems.push(err("/level", `ukendt autonominiveau '${grant.level}'`));
  if (!(grant.changeRef ?? "").trim()) problems.push(err("/changeRef", "bevillingen skal pege på en versionsstyret change"));
  if (!(grant.approvedAt ?? "").trim()) problems.push(err("/approvedAt", "bevillingen mangler godkendelsestidspunkt"));
  if (!(grant.expiresAt ?? "").trim()) problems.push(err("/expiresAt", "bevillingen mangler udløb"));
  if (Date.parse(grant.expiresAt) <= Date.parse(grant.approvedAt)) problems.push(err("/expiresAt", "udløbet skal ligge efter godkendelsen"));

  const scope = grant.scope ?? {};
  if (!["replay", "staging"].includes(scope.environment)) problems.push(err("/scope/environment", "miljøet skal være replay eller staging"));
  if (isAtLeast(grant.level, EXECUTING_LEVEL) && scope.environment !== "staging") {
    problems.push(err("/scope/environment", "begrænset autonomi må kun gælde staging"));
  }
  if (scope.reversibilityRequired !== true) problems.push(err("/scope/reversibilityRequired", "bevillingen skal kræve reversibilitet"));
  if (scope.humanApprovalForMutations !== true) problems.push(err("/scope/humanApprovalForMutations", "bevillingen skal kræve menneskelig godkendelse af mutationer"));
  for (const verb of scope.verbs ?? []) {
    if (isIrreversibleVerb(verb)) problems.push(err("/scope/verbs", `det irreversible verbum '${verb}' må ikke være i scopet`));
  }
  if (!Array.isArray(scope.runbooks) || scope.runbooks.length === 0) problems.push(err("/scope/runbooks", "bevillingen skal angive forhåndsgodkendte runbooks"));

  const governance = grant.governance ?? {};
  if (governance.requiresKillSwitch !== true) problems.push(err("/governance/requiresKillSwitch", "bevillingen skal kræve et nødstop"));
  if (governance.requiresGovernance !== true) problems.push(err("/governance/requiresGovernance", "bevillingen skal kræve governance"));
  if (!(governance.killSwitchRef ?? "").trim()) problems.push(err("/governance/killSwitchRef", "bevillingen mangler en nødstop-reference"));
  if (!(governance.auditRef ?? "").trim()) problems.push(err("/governance/auditRef", "bevillingen mangler en audit-reference"));

  const evaluation = grant.evaluation ?? {};
  const expectedFingerprint = modelFingerprint({ modelRef: evaluation.modelRef, promptDigest: evaluation.promptDigest });
  if (evaluation.fingerprint !== expectedFingerprint) {
    problems.push(err("/evaluation/fingerprint", "fingeraftrykket matcher ikke model- og promptversionen"));
  }
  const minRuns = evaluation.minEvaluationRuns;
  if (!Number.isInteger(minRuns) || minRuns < 2) problems.push(err("/evaluation/minEvaluationRuns", "gentaget evaluering kræver mindst to kørsler"));
  const runs = evaluation.runs ?? [];
  if (runs.length < (minRuns ?? 2)) problems.push(err("/evaluation/runs", `kun ${runs.length} evalueringskørsler; kræver mindst ${minRuns ?? 2}`));
  for (const [i, run] of runs.entries()) {
    if (run.fingerprint !== evaluation.fingerprint) problems.push(err(`/evaluation/runs/${i}/fingerprint`, "evalueringskørslen bærer et andet fingeraftryk"));
    if (run.passed !== true) problems.push(err(`/evaluation/runs/${i}/passed`, "evalueringskørslen bestod ikke tærsklerne"));
  }
  if (evaluation.passed !== true) problems.push(err("/evaluation/passed", "evalueringen er ikke erklæret bestået"));
  if (Object.keys(evaluation.thresholds ?? {}).length === 0) problems.push(err("/evaluation/thresholds", "bevillingen mangler tærskler"));

  const history = grant.history ?? [];
  if (!Array.isArray(history) || history.length === 0) problems.push(err("/history", "bevillingen skal have en versionshistorik"));
  else {
    const latest = history[history.length - 1];
    if (latest.version !== grant.metadata?.version) problems.push(err("/history", "historikkens seneste version matcher ikke metadata.version"));
    if (latest.level !== grant.level) problems.push(err("/history", "historikkens seneste niveau matcher ikke bevillingens niveau"));
  }
  return problems;
}

/** Semantiske beslutninger for replay-datasættet. */
export function replayDatasetProblems(dataset) {
  const problems = [];
  if (!dataset || typeof dataset !== "object") return [err("/", "datasættet er ikke et objekt")];
  if (dataset.kind !== "ShadowReplayDataset") problems.push(err("/kind", "datasættet skal være af typen ShadowReplayDataset"));
  if (!isNamedHuman(dataset.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "datasættet skal have et navngivet menneske som ejer"));
  if (dataset.metadata?.anonymized !== true) problems.push(err("/metadata/anonymized", "historiske kundehændelser skal være anonymiserede"));
  const events = dataset.events ?? [];
  if (events.length === 0) problems.push(err("/events", "datasættet skal indeholde mindst én hændelse"));
  const ids = new Set();
  for (const [i, event] of events.entries()) {
    const at = `/events/${i}`;
    if (ids.has(event.id)) problems.push(err(`${at}/id`, `hændelsen '${event.id}' er erklæret flere gange`));
    ids.add(event.id);
    if (!event.modelObservation || typeof event.modelObservation.anomalyScore !== "number") problems.push(err(`${at}/modelObservation`, "hændelsen mangler en modelobservation med anomaliscore"));
    if (!event.groundTruth || typeof event.groundTruth.realIncident !== "boolean") problems.push(err(`${at}/groundTruth`, "hændelsen mangler ground truth"));
    if (!event.humanDecision) problems.push(err(`${at}/humanDecision`, "hændelsen mangler den menneskelige beslutning"));
    if (!(event.signal ?? event.modelObservation?.signal)) problems.push(err(`${at}/modelObservation/signal`, "hændelsen mangler et signal"));
    else if (!SIGNAL_PROPOSALS[event.modelObservation.signal]) problems.push(err(`${at}/modelObservation/signal`, `ukendt signal '${event.modelObservation.signal}'`));
  }
  return problems;
}

/**
 * Semantik for en kørt skyggekørsel. Den vigtigste invariant er hård: en
 * skyggekørsel må ikke have udført en eneste mutation.
 */
export function shadowRunProblems(run) {
  const problems = [];
  if (!run || typeof run !== "object") return [err("/", "kørslen er ikke et objekt")];
  if (run.kind !== "ShadowRun") problems.push(err("/kind", "kørslen skal være af typen ShadowRun"));
  if ((run.decisions ?? []).length !== run.eventsReplayed) problems.push(err("/decisions", "antallet af beslutninger matcher ikke de replayede hændelser"));
  if (run.safety?.zeroMutationInvariant !== true) problems.push(err("/safety/zeroMutationInvariant", "nul-mutationsinvarianten skal være sand"));
  if (run.mode === "shadow" && run.mutationCount !== 0) {
    problems.push(err("/mutationCount", `skyggetilstand udførte ${run.mutationCount} muterende handlinger — det er ikke tilladt`));
  }
  for (const [i, d] of (run.decisions ?? []).entries()) {
    if (run.mode === "shadow" && d.execution?.executed === true) problems.push(err(`/decisions/${i}/execution/executed`, "en skyggekørsel må ikke udføre handlinger"));
    if (d.execution?.executed === true && !d.proposal?.runbookRef) problems.push(err(`/decisions/${i}/proposal/runbookRef`, "en udført handling skal pege på en forhåndsgodkendt runbook"));
    if (d.execution?.executed === true && d.proposal?.reversible === false) problems.push(err(`/decisions/${i}/proposal/reversible`, "en udført handling skal være reversibel"));
  }
  if (run.metrics?.executedMutations !== run.mutationCount) problems.push(err("/metrics/executedMutations", "metrikken for udførte mutationer matcher ikke kørslen"));
  if (run.safety?.evaluationFingerprintMatch !== true) problems.push(err("/safety/evaluationFingerprintMatch", "model-/promptfingeraftrykket matcher ikke en evaluering"));
  return problems;
}
