/**
 * DKC-032 — replay-runner for skyggetilstand og begrænset autonomi.
 *
 * Runneren kobler den deterministiske skyggemotor til den RIGTIGE runbook- og
 * nødstopkode:
 *
 *   - forhåndsgodkendte runbooks slås op i `runbooks/registry.json` og
 *     valideres med `approvals/src/runbook.mjs` (scope + parametre) FØR en
 *     handling må udføres i staging,
 *   - den rigtige nødstopsklient (`credentials/src/kill-switch.mjs`) bruges
 *     fail-closed,
 *   - governance er en eksplicit probe; er den ikke tilgængelig, udføres intet.
 *
 * Selve staging-mutationen er ikke mulig i dette miljø (ingen levende klynge),
 * så den udførte effekt markeres `simulated: true`. Beslutningen og
 * autorisationen er derimod rigtig kode. En målt kørsel i en levende staging er
 * `make shadow-live` og er NOT RUN.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { scopeCovers, parameterProblems } from "../../approvals/src/runbook.mjs";
import { createKillSwitch } from "../../credentials/src/kill-switch.mjs";
import { isIrreversibleVerb } from "../../runtime/src/classification.mjs";
import { createAutonomyRegister, createShadowRunner, evaluateThresholds, evaluationRun } from "./shadow.mjs";

function loadRegistry(root) {
  const path = join(root, "runbooks", "registry.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")).runbooks ?? [];
}

function loadRunbook(root, ref) {
  const entry = loadRegistry(root).find((r) => r.ref === ref);
  if (!entry?.contract) return null;
  const path = isAbsolute(entry.contract) ? entry.contract : join(root, entry.contract);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Reviewer-agentens ekstra fund: det mennesket eller modellen ikke selv fangede. */
export function defaultReviewer({ event, diagnosis, proposal }) {
  const findings = [];
  if (diagnosis.incident && event.groundTruth?.realIncident === false) findings.push("falsk alarm: signal uden reel hændelse");
  if (proposal.mutating && isIrreversibleVerb(proposal.verb)) findings.push(`irreversibel handling '${proposal.verb}' kræver et menneske`);
  if (proposal.mutating && !proposal.runbookRef) findings.push("muterende forslag uden forhåndsgodkendt runbook");
  return { reviewerRef: "shadow-reviewer", findings };
}

/**
 * Den rigtige staging-executor: verificerer runbook-scope og -parametre mod de
 * kanoniske runbooks, før effekten registreres. Uden en levende stagingklynge er
 * effekten simuleret og bærer det eksplicit.
 */
export function createStagingExecutor(root, { audit = [] } = {}) {
  return async function execute({ event, diagnosis, proposal }) {
    const runbook = loadRunbook(root, proposal.runbookRef);
    if (!runbook) {
      audit.push({ eventId: event.id, runbookRef: proposal.runbookRef, ok: false, reason: "runbook ikke fundet" });
      return { ok: false, reason: "runbook ikke fundet" };
    }
    if (!scopeCovers(runbook, { verb: proposal.verb, target: event.target, environment: "staging", tenantId: event.tenantId ?? null })) {
      audit.push({ eventId: event.id, runbookRef: proposal.runbookRef, ok: false, reason: "handling uden for runbookens scope" });
      return { ok: false, reason: "handling uden for runbookens scope" };
    }
    const parameterIssues = parameterProblems(runbook, proposal.parameters ?? {});
    if (parameterIssues.length) {
      audit.push({ eventId: event.id, runbookRef: proposal.runbookRef, ok: false, reason: `parametre uden for grænserne: ${parameterIssues.map((p) => p.message).join("; ")}` });
      return { ok: false, reason: "parametre uden for grænserne" };
    }
    audit.push({ eventId: event.id, runbookRef: proposal.runbookRef, ok: true, simulated: true });
    return { ok: true, simulated: true, summary: `${proposal.verb} @ ${event.target} via ${proposal.runbookRef}` };
  };
}

/**
 * Kører både den rene skyggekørsel og den begrænsede autonomikørsel og bygger
 * den samlede rapport med en gate. Alt er deterministisk.
 */
export async function runShadowSuite(root, { policy, dataset, clock } = {}) {
  const loadJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));
  const grant = policy ?? loadJson("shadow/autonomy-policy.json");
  const replay = dataset ?? loadJson("shadow/replay-dataset.json");
  const register = createAutonomyRegister(grant, clock ? { clock } : {});
  const executorAudit = [];
  const baseOptions = {
    register,
    reviewer: defaultReviewer,
    killSwitch: createKillSwitch(),
    governance: { available: true },
    executor: createStagingExecutor(root, { audit: executorAudit }),
  };

  const shadow = await createShadowRunner(baseOptions).run({
    dataset: replay,
    mode: "shadow",
    environment: "replay",
    runId: "shadow-replay-2025-09-01",
    generatedAt: replay.metadata?.capturedAt ?? "2025-09-01T08:00:00Z",
  });

  const limited = await createShadowRunner(baseOptions).run({
    dataset: replay,
    mode: "limited-autonomy",
    environment: "staging",
    runId: "limited-autonomy-staging-2025-09-01",
    generatedAt: replay.metadata?.capturedAt ?? "2025-09-01T08:00:00Z",
  });

  const thresholdGate = evaluateThresholds(limited.metrics, grant.evaluation?.thresholds ?? {});
  const reasons = [...thresholdGate.reasons];
  if (shadow.mutationCount !== 0) reasons.push(`skyggetilstanden udførte ${shadow.mutationCount} mutationer`);
  if (shadow.verdict !== "pass") reasons.push("skyggekørslen bestod ikke sine invarianter");
  if (limited.safety.approvedRunbooksOnly !== true) reasons.push("en handling uden for de forhåndsgodkendte runbooks blev udført");

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ShadowReport",
    generatedAt: replay.metadata?.capturedAt ?? "2025-09-01T08:00:00Z",
    grantVersion: grant.metadata?.version ?? null,
    fingerprint: grant.evaluation?.fingerprint ?? null,
    measured: false,
    reason: "Deterministisk replay af historiske hændelser og en simuleret staging-effekt. Grundlaget er dækket af regressions- og konformanstests; måling mod en levende model og en levende stagingklynge er NOT RUN.",
    thresholds: grant.evaluation?.thresholds ?? {},
    evaluationRuns: grant.evaluation?.runs ?? [],
    shadow,
    limitedAutonomy: limited,
    executorAudit,
    gate: { status: reasons.length === 0 ? "pass" : "block", reasons },
  };
}

/** Bygger en evalueringskørsel fra den begrænsede autonomikørsel. */
export function buildEvaluationRun({ runId, run, thresholds }) {
  return evaluationRun({ runId, run, thresholds });
}
