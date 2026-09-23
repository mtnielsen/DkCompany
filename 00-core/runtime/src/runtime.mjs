import { randomUUID } from "node:crypto";
import { scanUntrusted } from "./injection.mjs";

export class BudgetExceeded extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

const MUTATING_VERBS = new Set([
  "restart",
  "scale",
  "rotate-credential",
  "drain",
  "upgrade",
  "upgrade.patch",
  "upgrade.minor",
  "upgrade.major",
  "config.apply",
  "restore",
  "migrate",
  "migrate.schema",
  "rollback",
  "subject.erase",
  "subject.export",
  "subject.legal_hold",
]);

/** A4: handlinger ingen agent må udføre — uanset godkendelse. */
const A4_TARGETS = /(^|\/)(policy|policy-bundles|audit|audit-log|audit-service|governance|rights|permissions|keys)(\/|$)/;

function withinScope(target, capTarget) {
  if (target === capTarget) return true;
  if (!capTarget.includes("*") && !capTarget.includes("?")) {
    return target.startsWith(capTarget + "/") || capTarget.startsWith(target + "/");
  }
  const re = new RegExp("^" + capTarget.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(target);
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
  executors = {},
  credentialIssuer,
  clock = () => Date.now(),
}) {
  if (!manifest) throw new Error("kræver et agent-manifest");
  if (!pdp) throw new Error("kræver en pdp-klient");
  if (!auditLog) throw new Error("kræver en audit-log");
  const capabilities = new Map((manifest.capabilities ?? []).map((c) => [c.verb, c]));
  const spiffeId = manifest.identity?.spiffeId;
  const budgetDefaults = manifest.escalation?.budget ?? {};

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

  function policyInput(action, capability, task) {
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
        ...(action.blastRadius ? { blastRadius: action.blastRadius } : {}),
        ...(action.untrustedInput !== undefined ? { untrustedInput: action.untrustedInput } : action.untrustedContent ? { untrustedInput: true } : {}),
        ...(action.changeUri ? { changeUri: action.changeUri } : {}),
      },
    };
  }

  async function runTask(task) {
    const startedAt = clock();
    const budget = { ...budgetDefaults, ...(task.budget ?? {}) };
    const credential = issueCredential({ agentRef: manifest.metadata.name, verbs: [...capabilities.keys()], ttlSeconds: manifest.identity?.maxCredentialTtlSeconds ?? 900 });
    const state = { tokens: 0, costEur: 0, counts: new Map(), results: [] };

    const finish = (status, extra = {}) => ({
      taskId: task.taskId,
      agentRef: manifest.metadata.name,
      status,
      credentialId: credential.id,
      tokensUsed: state.tokens,
      costEur: state.costEur,
      actionsRun: state.results.length,
      results: state.results,
      ...extra,
    });

    if (!(await tryAudit({ type: "agent.task.started", verb: null, payload: { objective: task.objective } }))) {
      return finish("halted", { reason: "audit-log utilgængelig — dødemandsgreb" });
    }

    for (const action of task.actions) {
      // JIT-credential skal være gyldigt netop nu.
      if (clock() >= credential.expiresAt) return finish("halted", { reason: "JIT-credential udløbet", action });

      // Kun deklarerede verber. Ingen fri shell.
      const capability = capabilities.get(action.verb);
      if (!capability) {
        await tryAudit({ type: "agent.refused", verb: action.verb, payload: { reason: "verb ikke deklareret" } });
        return finish("refused", { reason: `verbet '${action.verb}' er ikke deklareret i manifestet — ingen fri shell`, action });
      }
      // A4: agenten må ikke ændre policy, audit-log eller egne rettigheder.
      // Absolut forbud — kontrolleres før scope, så et bredt scope ikke åbner det.
      if (A4_TARGETS.test(action.target) && MUTATING_VERBS.has(action.verb)) {
        await tryAudit({ type: "agent.refused", verb: action.verb, payload: { reason: "A4-handling" } });
        return finish("refused", { reason: "A4: agenten må ikke ændre policy, audit-log eller egne rettigheder", action });
      }

      if (!withinScope(action.target, capability.target)) {
        await tryAudit({ type: "agent.refused", verb: action.verb, payload: { reason: "target uden for scope" } });
        return finish("refused", { reason: `target '${action.target}' er uden for capability-scope '${capability.target}'`, action });
      }

      // Loop-detektion: samme fix gentaget = symptomet er ikke årsagen.
      const key = `${action.verb}@${action.target}`;
      const count = (state.counts.get(key) ?? 0) + 1;
      state.counts.set(key, count);
      if (count > (manifest.escalation?.repeatFailureLimit ?? 3)) {
        await tryAudit({ type: "agent.escalated", verb: action.verb, payload: { reason: "loop", key, count } });
        return finish("escalated", { reason: `loop detekteret: '${key}' gentaget ${count} gange`, action });
      }

      // Prompt injection: instruktioner indlejret i utroværdigt input ignoreres.
      if (action.untrustedContent) {
        const scan = scanUntrusted(action.untrustedContent);
        if (scan.flagged) {
          await tryAudit({ type: "agent.injection.detected", verb: action.verb, payload: { findings: scan.findings } });
          return finish("escalated", { reason: `prompt injection i utroværdigt input: ${scan.findings.join(", ")}`, injectionFindings: scan.findings, action });
        }
      }

      // Policy — fail-closed.
      let decision;
      try {
        decision = await pdp.decide(policyInput(action, capability, task));
      } catch (err) {
        if (err.name === "GovernanceUnavailable" || /PDP utilgængelig/.test(err.message)) {
          await tryAudit({ type: "agent.halted", verb: action.verb, payload: { reason: "governance utilgængelig" } });
          return finish("halted", { reason: "governance utilgængelig — dødemandsgreb", action });
        }
        throw err;
      }

      if (decision.decision === "deny") {
        await tryAudit({ type: "agent.denied", verb: action.verb, payload: { reason: decision.reasons?.[0] } });
        return finish("denied", { reason: decision.reasons?.[0] ?? "policy deny", action });
      }

      // A3 (eller policy-krav) kræver et menneske.
      if (capability.autonomyClass === "A3" || decision.decision === "allow-with-approval") {
        const required = decision.requiredApprovals ?? 1;
        const approvals = (action.approvals ?? []).filter((a) => a.verdict === "approve");
        if (approvals.length < required) {
          await tryAudit({ type: "agent.escalated", verb: action.verb, payload: { reason: "approval required", required } });
          return finish("escalated", { reason: "menneskelig godkendelse påkrævet", requiredApprovals: required, action });
        }
      }

      // Evidens.
      const requiredEvidence = new Set([...(decision.requiredEvidence ?? []), ...(capability.requiredEvidence ?? [])]);
      const missing = [...requiredEvidence].filter((e) => e !== "policy-allow" && !(action.evidence ?? []).includes(e));
      if (missing.length) {
        await tryAudit({ type: "agent.refused", verb: action.verb, payload: { reason: "manglende evidens", missing } });
        return finish("refused", { reason: `manglende evidens: ${missing.join(", ")}`, missingEvidence: missing, action });
      }

      // Budget (før udførelse): wall clock.
      if (budget.maxWallClockSeconds && (clock() - startedAt) / 1000 > budget.maxWallClockSeconds) {
        await tryAudit({ type: "agent.escalated", verb: action.verb, payload: { reason: "wall clock budget" } });
        return finish("escalated", { reason: "budget: wall clock overskredet", action });
      }

      const executor = executors[action.verb];
      if (!executor) {
        await tryAudit({ type: "agent.refused", verb: action.verb, payload: { reason: "ingen executor" } });
        return finish("refused", { reason: `ingen executor for '${action.verb}'`, action });
      }

      let result;
      try {
        result = await executor({ ...action, agentRef: manifest.metadata.name, credential: { id: credential.id }, gateway });
      } catch (err) {
        await tryAudit({ type: "agent.action.failed", verb: action.verb, payload: { error: err.message } });
        return finish("escalated", { reason: `handling fejlede: ${err.message}`, failedAction: action });
      }

      state.tokens += result?.tokens ?? 0;
      state.costEur += result?.costEur ?? 0;
      state.results.push({ verb: action.verb, target: action.target, summary: result?.summary ?? null });

      if (!(await tryAudit({ type: "agent.action.completed", verb: action.verb, payload: { summary: result?.summary ?? null } }))) {
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

    if (!(await tryAudit({ type: "agent.task.completed", verb: null, payload: { actionsRun: state.results.length } }))) {
      return finish("halted", { reason: "audit-log utilgængelig — dødemandsgreb" });
    }
    return finish("completed");
  }

  return { runTask, capabilities, spiffeId };
}
