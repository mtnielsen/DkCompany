import { randomUUID } from "node:crypto";
import { scanAll } from "./injection.mjs";
import { createToolBoundary } from "./tools.mjs";
import { buildTaskFromProposal, parseModelOutput, separateUntrusted } from "./untrusted.mjs";
import { isA4Violation } from "./classification.mjs";
import { RuntimeBoundaryError, validateActionBoundary, validateManifest, validatePolicyDecision, validateTaskShape } from "./boundary.mjs";
import { createFileArtifactLoader, verifyEvidenceReferences } from "./evidence.mjs";
import { digestOf } from "./digest.mjs";
import { guardRoleAction } from "../../agent-registry/src/runtime-role-guard.mjs";

/**
 * DKC-009: et stabilt idempotency-ID pr. handling. Samme task+handling giver
 * samme ID, så en genkørsel efter et nedbrud møder det eksisterende intent i
 * stedet for at udføre handlingen igen.
 */
function deriveIdempotencyId(taskId, index, action) {
  return digestOf({ taskId: taskId ?? null, index, verb: action.verb, target: action.target, changeDigest: action.changeDigest ?? null }).slice(0, 32);
}

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
  actionJournal = null,
  credentialBroker = null,
  killSwitch = null,
  credentialTtlSeconds = null,
  toolBoundary = null,
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
  // DKC-011: servervalideret, typet værktøjsgrænse. Runtimen kalder aldrig en
  // executor uden at værktøjskaldet først er valideret mod allowlisten.
  const tools = toolBoundary ?? createToolBoundary();

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
        role: manifest.role,
        autonomyClass: capability.autonomyClass,
        ...(manifest.metadata?.accountableHuman?.subject ? { onBehalfOf: manifest.metadata.accountableHuman.subject } : {}),
      },
      action: {
        verb: action.verb,
        target: action.target,
        environment: action.environment,
        autonomyClass: capability.autonomyClass,
        role: manifest.role,
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
    // Legacy/default-stien udsteder ét UUID-credential for opgaven. DKC-010-stien
    // (credentialBroker) udsteder i stedet et kortlivet, scope-bundet token pr.
    // handling lige før eksekvering.
    const taskCredential = credentialBroker
      ? null
      : issueCredential({ agentRef: manifest.metadata.name, verbs: [...capabilities.keys()], ttlSeconds: manifest.identity?.maxCredentialTtlSeconds ?? 900 });
    let activeCredential = taskCredential;
    const state = { tokens: 0, costEur: 0, counts: new Map(), results: [] };

    const finish = (status, extra = {}) => {
      const result = {
        taskId: task.taskId,
        agentRef: manifest.metadata.name,
        tenantId: task.tenantId ?? tenantId ?? null,
        status,
        credentialId: activeCredential?.id ?? null,
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

    for (const [actionIndex, action] of task.actions.entries()) {
      // DKC-010: nødstop kontrolleres før hver handling (fail-closed). Et aktivt
      // nødstop på agent-, kunde- eller globalt niveau afviser alle nye
      // handlinger.
      if (killSwitch) {
        try {
          killSwitch.assertAllowed({ tenantId: jobTenant, spiffeId });
        } catch (err) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.halted", verb: action.verb, payload: { reason: "nødstop aktivt", code: err.code ?? null } });
          return finish("halted", { reason: "nødstop aktivt — handling afvist", emergencyStop: true, action });
        }
      }

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

      // DKC-055: rollen er uforanderlig og kan ikke overskride sine beføjelser.
      const roleCheck = guardRoleAction({ manifest, action, approvedScope: task.approvedScope ?? null });
      if (!roleCheck.ok) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: action.verb, payload: { reason: "rollebrud", violations: roleCheck.errors } });
        return finish("refused", { reason: `handlingen er i strid med agentens rolle '${manifest.role}': ${roleCheck.errors.map((e) => e.message).join("; ")}`, roleViolations: roleCheck.errors, action });
      }

      // DKC-011: servervalideret, typet værktøjskald. Ukendte værktøjer, forkerte
      // parametre, for store input, farlige parameternavne og uautoriserede
      // URL'er afvises, før nogen executor ser kaldet. Der findes ingen fri shell.
      const toolCheck = tools.validate({
        verb: action.verb,
        tool: action.tool ?? capability.tool ?? null,
        params: action.parameters ?? {},
        target: action.target,
        tenantId: jobTenant,
      });
      if (!toolCheck.ok) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.refused", verb: action.verb, payload: { reason: "værktøjsgrænse", violations: toolCheck.errors } });
        return finish("refused", { reason: `værktøjskaldet er afvist ved grænsen: ${toolCheck.errors.map((e) => e.message).join("; ")}`, toolViolations: toolCheck.errors, action });
      }

      // Loop-detektion: samme fix gentaget = symptomet er ikke årsagen.
      const key = `${action.verb}@${action.target}`;
      const count = (state.counts.get(key) ?? 0) + 1;
      state.counts.set(key, count);
      if (count > (manifest.escalation?.repeatFailureLimit ?? 3)) {
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.escalated", verb: action.verb, payload: { reason: "loop", key, count } });
        return finish("escalated", { reason: `loop detekteret: '${key}' gentaget ${count} gange`, action });
      }

      // DKC-011: ubetroet indhold (logs, dokumenter, mails, tool-output,
      // model-output) adskilles fra det eksekverbare kald. Indholdet er data og
      // scannes kun som et *ekstra signal*: selv et mønster scanneren ikke
      // kender, kan ikke udvide rettigheder, fordi verbum, mål og parametre
      // valideres uafhængigt ovenfor.
      const { content: untrustedContent } = separateUntrusted(action);
      if (untrustedContent.length > 0) {
        const scan = scanAll(untrustedContent);
        if (scan.flagged) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.injection.detected", verb: action.verb, payload: { findings: scan.findings, categories: scan.categories } });
          return finish("escalated", { reason: `prompt injection i ubetroet indhold: ${scan.findings.join(", ")}`, injectionFindings: scan.findings, injectionCategories: scan.categories, action });
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
            planSha256: action.planDigest ?? null,
            runbookSha256: action.runbookDigest ?? null,
            producer: action.producer ?? null,
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

      // DKC-010: udsted et kortlivet, scope-bundet credential til netop denne
      // handling. Tokenet bindes til kunden, ressourcen, verbet, miljøet og den
      // tilsigtede executor (audience), og forankres kryptografisk i KMS-signereren.
      if (credentialBroker) {
        const audience = action.audience ?? capability.executor ?? `module:${String(action.target).split("/")[0]}`;
        try {
          const issued = credentialBroker.issue({
            spiffeId,
            agentRef: manifest.metadata.name,
            role: manifest.role,
            tenantId: jobTenant,
            verb: action.verb,
            resource: action.target,
            audience,
            environment: action.environment,
            taskId: task.taskId,
            ttlSeconds: credentialTtlSeconds ?? manifest.identity?.maxCredentialTtlSeconds ?? 900,
          });
          activeCredential = { id: issued.jti, token: issued.token, claims: issued.claims, audience, expiresAt: issued.claims.exp * 1000 };
        } catch (err) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.halted", verb: action.verb, payload: { reason: "credential kunne ikke udstedes", error: err.message } });
          return finish("halted", { reason: `kunne ikke udstede scoped credential: ${err.message}`, action });
        }
      }
      // JIT-credential skal være gyldigt netop nu.
      if (!activeCredential || clock() >= activeCredential.expiresAt) return finish("halted", { reason: "JIT-credential udløbet", action });

      // DKC-009: skriv den vedvarende intent (med idempotency-ID) og få en
      // holdbar kvittering FØR nogen ekstern ændring. Er audit-loggen
      // utilgængelig, eller findes intentet allerede, udføres der intet.
      const idempotencyId = action.idempotencyId ?? deriveIdempotencyId(task.taskId, actionIndex, action);
      if (actionJournal) {
        let receipt;
        try {
          receipt = await actionJournal.begin({
            tenantId: jobTenant,
            idempotencyId,
            verb: action.verb,
            target: action.target,
            environment: action.environment,
            actor: spiffeId,
            request: { parameters: action.parameters ?? null, changeDigest: action.changeDigest ?? null },
            dataCategories: action.dataCategories ?? [],
          });
        } catch (err) {
          await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.halted", verb: action.verb, payload: { reason: "audit-log utilgængelig før handling", error: err.message } });
          return finish("halted", { reason: "audit-log utilgængelig før handling — dødemandsgreb", action, idempotencyId });
        }
        if (!receipt?.ok) {
          if (receipt?.state === "succeeded" || receipt?.state === "failed") {
            return finish(receipt.state === "succeeded" ? "completed" : "escalated", {
              reason: "handlingen er allerede afsluttet — idempotent genkørsel udfører intet",
              replayedOutcome: receipt.outcome ?? null,
              idempotencyId,
              action,
            });
          }
          return finish("unknown", {
            reason: "der findes et audit-intent uden outcome — afventer reconciliation, der genudføres intet",
            idempotencyId,
            action,
          });
        }
      }

      let result;
      try {
        result = await executor({ ...action, tenantId: jobTenant, agentRef: manifest.metadata.name, credential: activeCredential, gateway });
      } catch (err) {
        if (actionJournal) {
          try {
            await actionJournal.complete({ tenantId: jobTenant, idempotencyId, outcome: "failed", error: err.message });
          } catch {
            return finish("unknown", { reason: "handling fejlede, og outcome kunne ikke logges — afventer reconciliation", idempotencyId, action });
          }
        }
        await tryAudit({ tenantId: task.tenantId ?? null, type: "agent.action.failed", verb: action.verb, payload: { error: err.message } });
        return finish("escalated", { reason: `handling fejlede: ${err.message}`, failedAction: action });
      }

      // DKC-009: den eksterne ændring er sket. Outcome skal være holdbart, før
      // der kan rapporteres success — ellers er resultatet `unknown`.
      if (actionJournal) {
        try {
          const completed = await actionJournal.complete({ tenantId: jobTenant, idempotencyId, outcome: "succeeded", result: result ?? null });
          if (!completed?.ok) throw new Error("outcome blev ikke bekræftet");
        } catch {
          return finish("unknown", { reason: "handlingen blev udført, men outcome kunne ikke logges — afventer reconciliation", idempotencyId, action });
        }
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

  /**
   * DKC-009: reconciliation af intents der står `pending`/`unknown` efter et
   * nedbrud. `resolve` undersøger den eksterne ressource; uden en resolver
   * markeres intentet blot `unknown`. Der genudføres aldrig en handling her.
   */
  async function reconcile({ tenantId: reconcileTenant = null, idempotencyId, resolve = null } = {}) {
    if (!actionJournal || typeof actionJournal.reconcile !== "function") throw new Error("runtimen er ikke konfigureret med en actionJournal der kan reconciliere");
    return actionJournal.reconcile({ tenantId: reconcileTenant ?? tenantId, idempotencyId, resolve });
  }

  function pendingActions() {
    return typeof actionJournal?.unresolved === "function" ? actionJournal.unresolved() : [];
  }

  /**
   * DKC-011: kør en opgave der stammer fra model-output. Model-output er
   * ubetroet, også når det er gyldig JSON. Serveren fastsætter identitet, kunde
   * og agentRef; kun `actions` kommer fra forslaget, og hvert kald møder den
   * fulde runtimegrænse (verbum, A4, scope, rolle, typet værktøj, PDP).
   */
  async function runProposedTask({
    rawOutput,
    taskId = randomUUID(),
    tenantId: proposedTenant = null,
    agentRef = manifest.metadata.name,
    objective = "model proposal",
    evidenceIndex: proposedEvidence = null,
    budget = null,
  } = {}) {
    const proposal = parseModelOutput(rawOutput);
    const candidate = buildTaskFromProposal(proposal, {
      taskId,
      tenantId: proposedTenant ?? tenantId,
      agentRef,
      objective,
      evidenceIndex: proposedEvidence,
      budget,
      modelRef: manifest.model?.gatewayRef ?? "gateway",
    });
    return runTask(candidate);
  }

  return { runTask, runProposedTask, capabilities, spiffeId, toolBoundary: tools, reconcile, pendingActions };
}

export { RuntimeBoundaryError } from "./boundary.mjs";
