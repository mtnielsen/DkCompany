import { randomUUID } from "node:crypto";
import { scanUntrusted } from "./injection.mjs";
import { isA4Violation } from "./classification.mjs";
import { RuntimeBoundaryError, validateActionBoundary, validateManifest, validatePolicyDecision, validateTaskShape } from "./boundary.mjs";
import { createFileArtifactLoader, verifyEvidenceReferences } from "./evidence.mjs";

export class BudgetExceeded extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

function defaultCredentialIssuer({ ttlSeconds }, clock) {
  return { id: randomUUID(), ttlSeconds, issuedAt: clock(), expiresAt: clock() + ttlSeconds * 1000 };
}

/**
 * Agent-runtime.
 *
 * Agenten er en principal med SPIFFE-identitet og just-in-time credentials.
 * Den må kun udføre verber, der er deklareret i manifestet — der findes ingen
 * fri shell. Den spørger central PDP før hver handling og stopper, hvis
 * governance er utilgængelig (dødemandsgreb). Budgetter og loop-detektion
 * eskalerer i stedet for at fortsætte.
 */
export function createAgentRuntime({
  manifest,
  pdp,
  auditLog,
  gateway,
  approvalVerifier = null,
  executors = {},
  credentialIssuer,
  tenantId = null,
  evidenceIndex = null,
  artifactLoader = null,
  jobStore = null,
  clock = () => Date.now(),
}) {
  if (!manifest) throw new Error("kræver et agent-manifest");
  if (!pdp) throw new Error("kræver en pdp-klient");
  if (!auditLog) throw new Error("kræver en audit-log");
  const manifestCheck = validateManifest(manifest);
  if (!manifestCheck.ok) {
    throw new RuntimeBoundaryError("agent-manifestet er ugyldigt", manifestCheck.errors);
  }
  const capabilities = new Map((manifest.capabilities ?? []).map((c) => [c.verb, c]));
  const spiffeId = manifest.identity?.spiffeId;
  const budgetDefaults = manifest.escalation?.budget ?? {};
  const loadArtifact = artifactLoader ?? createFileArtifactLoader();

  const issueCredential = credentialIssuer ?? ((opts) => defaultCredentialIssuer(opts, clock));

  async function tryAudit(event) {
    try {
      await auditLog.append({
        at: new Date(clock()).toISOString(),
        principal: { kind: "agent", id: spiffeId },
        ...event,
      });
      return true;
    } catch {
      return false;
    }
  }

  function policyInput(action, capability, task, evidenceSha256 = {}) {
    return {
      principal: {
        kind: "agent",
        id: spiffeId,
        spiffeId,
        autonomyClass: capability.autonomyClass,
        ...(manifest.metadata?.accountableHuman?.subject ? { onBehalfOf: manifest.metadata.accountableHuman.subject } : {}),
      },
      action: {
        verb: action.verb,
        target: action.target,
        environment: action.environment,
        autonomyClass: capability.autonomyClass,
      },
      context: {
        tenantId: task.tenantId ?? null,
        evidence: action.evidence ?? [],
        evidenceSha256,
        ...(action.blastRadius ? { blastRadius: action.blastRadius } : {}),
        ...(action.untrustedInput !== undefined ? { untrustedInput: action.untrustedInput } : action.untrustedContent ? { untrustedInput: true } : {}),
        ...(action.changeUri ? { changeUri: action.changeUri } : {}),
        ...(action.changeDigest ? { changeSha256: action.changeDigest } : {}),
      },
    };
  }

  async function runTask(task) {
    // DKC-007: tasken valideres ved grænsen. Et ugyldigt eller tvetydigt input
    // må ikke nå en executor.
    const taskCheck = validateTaskShape(task);
    if (!taskCheck.ok) {
      await tryAudit({ tenantId: task?.tenantId ?? null, type: "agent.refused", verb: null, payload: { reason: "ugyldig task", violations: taskCheck.errors } });
      return { taskId: task?.taskId ?? null, agentRef: manifest.metadata.name, status: "refused", reason: "tasken er ugyldig ved runtimegrænsen", boundaryViolations: taskCheck.errors };
    }
    if (task.agentRef !== manifest.metadata.name) {
      await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: null, payload: { reason: "agentRef-mismatch" } });
      return { taskId: task.taskId, agentRef: manifest.metadata.name, status: "refused", reason: `taskens agentRef '${task.agentRef}' matcher ikke manifestet '${manifest.metadata.name}'` };
    }

    // DKC-006: opgavens tenant skal stemme med den tenant agenten er autoriseret
    // til. En baggrundsopgave kan ikke pege på en anden kunde end agentens.
    if (tenantId && task.tenantId && String(task.tenantId).toLowerCase() !== String(tenantId).toLowerCase()) {
      await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: null, payload: { reason: "tenant-mismatch" } });
      return { taskId: task.taskId, agentRef: manifest.metadata.name, status: "refused", tenantId: task.tenantId ?? null, reason: `opgavens tenant '${task.tenantId}' matcher ikke agentens '${tenantId}'` };
    }
    const startedAt = clock();
    // DKC-008: holdbar jobtilstand. `ensure` er idempotent, så en genstart kan
    // fortsætte samme task uden at tabe det der allerede er committet.
    const jobTenant = task.tenantId ?? tenantId ?? null;
    const jobState = { objective: task.objective, agentRef: manifest.metadata.name, actions: [] };
    const persistJob = (status, extra = {}) => {
      if (!jobStore || !task.taskId) return;
      try {
        jobStore.ensure(jobTenant, { id: task.taskId, kind: "agent-task", payload: { agentRef: manifest.metadata.name, objective: task.objective } });
        jobStore.saveState(jobTenant, task.taskId, { status, state: { ...jobState, ...extra } });
      } catch {
        /* jobpersistens er best-effort og må ikke ændre selve eksekveringen */
      }
    };
    persistJob("running");
    const resolvedEvidenceIndex = { ...(evidenceIndex ?? {}), ...(task.evidenceIndex ?? {}) };
    const budget = { ...budgetDefaults, ...(task.budget ?? {}) };
    const credential = issueCredential({ agentRef: manifest.metadata.name, verbs: [...capabilities.keys()], ttlSeconds: manifest.identity?.maxCredentialTtlSeconds ?? 900 });
    const state = { tokens: 0, costEur: 0, counts: new Map(), results: [] };

    const finish = (status, extra = {}) => {
      const result = {
        taskId: task.taskId,
        agentRef: manifest.metadata.name,
        tenantId: task.tenantId ?? tenantId ?? null,
        status,
        credentialId: credential.id,
        tokensUsed: state.tokens,
        costEur: state.costEur,
        actionsRun: state.results.length,
        results: state.results,
        ...extra,
      };
      persistJob(status, result);
      return result;
    };

    if (!(await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.task.started", verb: null, payload: { objective: task.objective } }))) {
      return finish("halted", { reason: "audit-log utilgængelig — dødemandsgreb" });
    }

    for (const action of task.actions) {
      // JIT-credential skal være gyldigt netop nu.
      if (clock() >= credential.expiresAt) return finish("halted", { reason: "JIT-credential udløbet", action });

      // Kun deklarerede verber. Ingen fri shell.
      const capability = capabilities.get(action.verb);
      if (!capability) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: action.verb, payload: { reason: "verb ikke deklareret" } });
        return finish("refused", { reason: `verbet '${action.verb}' er ikke deklareret i manifestet — ingen fri shell`, action });
      }
      // A4: agenten må ikke ændre policy, audit-log eller egne rettigheder.
      // Absolut forbud — kontrolleres før scope, så et bredt scope ikke åbner
      // det. Klassifikationen er fælles og normaliserer mål, så case, aliaser
      // og encoding ikke kan omgå den.
      if (isA4Violation(action.verb, action.target)) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: action.verb, payload: { reason: "A4-handling", target: action.target } });
        return finish("refused", { reason: "A4: agenten må ikke ændre policy, audit-log eller egne rettigheder", action });
      }

      // Miljø, ownedComponents, datakategori og ensrettet target-scope.
      const boundary = validateActionBoundary(action, { manifest });
      if (!boundary.ok) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: action.verb, payload: { reason: "scope-/miljøbrud", violations: boundary.errors } });
        return finish("refused", { reason: `handlingen er uden for agentens scope: ${boundary.errors.map((e) => e.message).join("; ")}`, boundaryViolations: boundary.errors, action });
      }

      // Loop-detektion: samme fix gentaget = symptomet er ikke årsagen.
      const key = `${action.verb}@${action.target}`;
      const count = (state.counts.get(key) ?? 0) + 1;
      state.counts.set(key, count);
      if (count > (manifest.escalation?.repeatFailureLimit ?? 3)) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.escalated", verb: action.verb, payload: { reason: "loop", key, count } });
        return finish("escalated", { reason: `loop detekteret: '${key}' gentaget ${count} gange`, action });
      }

      // Prompt injection: instruktioner indlejret i utroværdigt input ignoreres.
      if (action.untrustedContent) {
        const scan = scanUntrusted(action.untrustedContent);
        if (scan.flagged) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.injection.detected", verb: action.verb, payload: { findings: scan.findings } });
          return finish("escalated", { reason: `prompt injection i utroværdigt input: ${scan.findings.join(", ")}`, injectionFindings: scan.findings, action });
        }
      }

      // Evidens: slå hver erklæret label op og bind den til digest/commit.
      // `policy-allow` er intrinsisk (PDP-beslutningen); alt andet kræver en
      // reference. En bar tekstetikette accepteres ikke.
      const evidenceCheck = verifyEvidenceReferences({
        labels: action.evidence ?? [],
        index: { ...resolvedEvidenceIndex, ...(action.evidenceIndex ?? {}) },
        artifactLoader: loadArtifact,
        changeDigest: action.changeDigest ?? null,
      });
      const evidenceSha256 = Object.fromEntries(Object.entries(evidenceCheck.verified).map(([k, v]) => [k, v.sha256 ?? "intrinsic"]));

      // Policy — fail-closed.
      const input = policyInput(action, capability, task, evidenceSha256);
      let decision;
      try {
        decision = await pdp.decide(input);
      } catch (err) {
        if (err.name === "GovernanceUnavailable" || /PDP utilgængelig/.test(err.message)) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.halted", verb: action.verb, payload: { reason: "governance utilgængelig" } });
          return finish("halted", { reason: "governance utilgængelig — dødemandsgreb", action });
        }
        throw err;
      }

      // DKC-007: et ukendt, tomt eller ikke-bundet PDP-svar afvises før executor.
      const decisionCheck = validatePolicyDecision(decision, { input });
      if (!decisionCheck.ok) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.halted", verb: action.verb, payload: { reason: "ugyldig PDP-beslutning", violations: decisionCheck.errors } });
        return finish("halted", { reason: `ugyldig eller ubundet PDP-beslutning — dødemandsgreb: ${decisionCheck.errors.map((e) => e.message).join("; ")}`, boundaryViolations: decisionCheck.errors, action });
      }

      if (decision.decision === "deny") {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.denied", verb: action.verb, payload: { reason: decision.reasons?.[0] } });
        return finish("denied", { reason: decision.reasons?.[0] ?? "policy deny", action });
      }

      // A3 (eller policy-krav) kræver en serververificeret menneskelig
      // godkendelse. `action.approvals` er ikke tillid — den ignoreres helt, og
      // der kræves et approval-ID, som godkendelsestjenesten kan verificere.
      const needsApproval = capability.autonomyClass === "A3" || decision.decision === "allow-with-approval";
      if (needsApproval) {
        const required = decision.requiredApprovals ?? 1;
        if (!action.approvalId) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.escalated", verb: action.verb, payload: { reason: "approvalId mangler", required } });
          return finish("escalated", { reason: "menneskelig godkendelse påkrævet: approvalId mangler", requiredApprovals: required, action });
        }
        if (!approvalVerifier) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.halted", verb: action.verb, payload: { reason: "approval-service er ikke konfigureret" } });
          return finish("halted", { reason: "approval-service er ikke konfigureret — dødemandsgreb", requiredApprovals: required, action });
        }
      }

      // Evidens: den påkrævede mængde skal være verificeret og bundet, ikke
      // blot nævnt som en streng.
      const requiredEvidence = new Set([...(decision.requiredEvidence ?? []), ...(capability.requiredEvidence ?? [])]);
      const missing = [...requiredEvidence].filter((e) => e !== "policy-allow" && !evidenceCheck.verified[e]);
      if (missing.length) {
        const problems = [...evidenceCheck.problems, ...missing.map((label) => ({ label, problem: `påkrævet bevis '${label}' er ikke verificeret` }))];
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: action.verb, payload: { reason: "manglende verificeret evidens", missing, problems } });
        return finish("refused", { reason: `manglende eller uverificeret evidens: ${missing.join(", ")}`, missingEvidence: missing, evidenceProblems: problems, action });
      }

      // Budget (før udførelse): wall clock.
      if (budget.maxWallClockSeconds && (clock() - startedAt) / 1000 > budget.maxWallClockSeconds) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.escalated", verb: action.verb, payload: { reason: "wall clock budget" } });
        return finish("escalated", { reason: "budget: wall clock overskredet", action });
      }

      const executor = executors[action.verb];
      if (!executor) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: action.verb, payload: { reason: "ingen executor" } });
        return finish("refused", { reason: `ingen executor for '${action.verb}'`, action });
      }

      // Revalidér og forbrug godkendelsen umiddelbart før handlingen. Dermed er
      // vinduet mellem den menneskelige beslutning og eksekveringen lukket, og
      // to samtidige workers kan ikke forbruge samme godkendelse.
      if (needsApproval) {
        let authorization;
        try {
          authorization = await approvalVerifier.authorizeExecution({
            approvalId: action.approvalId,
            executionId: action.executionId ?? action.approvalId,
            tenantId: task.tenantId ?? null,
            verb: action.verb,
            environment: action.environment,
            target: action.target,
            diffSha256: action.changeDigest ?? null,
            parameters: action.parameters ?? null,
            policyBundleVersion: action.policyBundleVersion ?? null,
          });
        } catch (err) {
          if (err.name === "ApprovalUnavailable" || /approval-service utilgængelig/.test(err.message)) {
            await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.halted", verb: action.verb, payload: { reason: "approval-service utilgængelig" } });
            return finish("halted", { reason: "approval-service utilgængelig — dødemandsgreb", action });
          }
          throw err;
        }
        if (!authorization?.ok) {
          const reasons = authorization?.reasons ?? ["ukendt afvisning"];
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.escalated", verb: action.verb, payload: { reason: "godkendelse afvist", reasons } });
          return finish("escalated", { reason: `godkendelsen kunne ikke verificeres: ${reasons.join("; ")}`, approvalReasons: reasons, action });
        }
      }

      let result;
      try {
        result = await executor({ ...action, agentRef: manifest.metadata.name, credential: { id: credential.id }, gateway });
      } catch (err) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.action.failed", verb: action.verb, payload: { error: err.message } });
        return finish("escalated", { reason: `handling fejlede: ${err.message}`, failedAction: action });
      }

      state.tokens += result?.tokens ?? 0;
      state.costEur += result?.costEur ?? 0;
      state.results.push({ verb: action.verb, target: action.target, summary: result?.summary ?? null });
      // Committet handling: gem jobtilstanden før næste handling, så et
      // procesnedbrud ikke taber hvad der allerede er udført.
      if (jobStore && task.taskId) {
        try {
          jobStore.saveState(jobTenant, task.taskId, { status: "running", state: { ...jobState, actions: state.results } });
        } catch {
          /* best-effort */
        }
      }

      if (!(await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.action.completed", verb: action.verb, payload: { summary: result?.summary ?? null } }))) {
        return finish("halted", { reason: "audit-log utilgængelig — dødemandsgreb", action });
      }

      // Budget (efter udførelse): tokens og cost.
      if (budget.maxTokens && state.tokens > budget.maxTokens) {
        return finish("escalated", { reason: "budget: tokens overskredet", action });
      }
      if (budget.maxCostEur && state.costEur > budget.maxCostEur) {
        return finish("escalated", { reason: "budget: cost EUR overskredet", action });
      }
    }

    if (!(await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.task.completed", verb: null, payload: { actionsRun: state.results.length } }))) {
      return finish("halted", { reason: "audit-log utilgængelig — dødemandsgreb" });
    }
    return finish("completed");
  }

  return { runTask, capabilities, spiffeId };
}

export { RuntimeBoundaryError } from "./boundary.mjs";
