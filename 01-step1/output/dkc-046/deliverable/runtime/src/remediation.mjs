/**
 * DKC-046 — begrænset selvreparation med sikker fallback.
 *
 * Modulet er en **deterministisk orkestrator** — ikke én flerrolleagent. Den
 * driver en lille, eksplicit tilstandsmaskine:
 *
 *   detect → correlate → diagnose → propose → policy/approval → durable intent
 *          → execute → verify → recovered | rolled_back | escalate | halt
 *
 * Håndhævede grænser:
 *
 *   - Kun godkendte runbooks med verificerede parametergrænser (DKC-045).
 *   - Ressourcelease + cooldown, så to agenter ikke reparerer samme ressource
 *     samtidigt.
 *   - Et samlet forsøgs-/fejl-/ændringsbudget på tværs af agenter.
 *   - Healthchecks af brugerflow over en observationstid; forværring stopper
 *     og ruller tilbage eller falder tilbage.
 *   - Foruddefinerede, autoriserede fallback-handlinger (pause, read-only,
 *     isolation) der kan køre uden model.
 *   - A4/AI-immutable, PDP, approval og audit respekteres; tab af audit/PDP
 *     stopper nye agentmutationer, men uafhængige, godkendte
 *     infrastrukturfunktioner fortsætter.
 *   - Irreversible verber (migrate, restore, …) beskrives aldrig som generelt
 *     reversible; de kræver menneske.
 *
 * Leasen kan holdes i hukommelsen eller i et filbaseret lager (`wx`), så den
 * også virker mellem processer på samme host. På tværs af noder kræves en
 * delt låsetjeneste (ekstern).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyVerb, compensationFor, isIrreversibleVerb } from "./classification.mjs";
import { guardIndependentVerification } from "../../agent-registry/src/runtime-role-guard.mjs";
import { scopeCovers, parameterProblems, preApprovalValid } from "../../approvals/src/runbook.mjs";

export const REMEDIATION_STATES = [
  "detected",
  "correlated",
  "diagnosed",
  "proposed",
  "authorized",
  "intent",
  "executing",
  "verifying",
  "recovered",
  "rolled_back",
  "escalated",
  "halted",
  "cooldown",
];

const TRANSITIONS = {
  detected: ["correlated", "escalated", "halted", "cooldown"],
  correlated: ["diagnosed", "escalated", "halted", "cooldown"],
  diagnosed: ["proposed", "escalated", "halted"],
  proposed: ["authorized", "escalated", "halted"],
  authorized: ["intent", "escalated", "halted"],
  intent: ["executing", "halted"],
  executing: ["verifying", "rolled_back", "escalated", "halted"],
  verifying: ["recovered", "rolled_back", "escalated", "halted"],
  recovered: [],
  rolled_back: ["escalated"],
  escalated: [],
  halted: [],
  cooldown: [],
};

/** De to runbooks en selvreparation må starte med. Alt andet kræver særskilt evidens. */
export const DEFAULT_REMEDIATION_RUNBOOKS = new Set(["stateless-restart@1.0.0", "bounded-scale@1.0.0"]);

/** Foruddefinerede, sikre fallback-handlinger: de reducerer adgang, udvider ikke. */
export const SAFE_FALLBACK_ACTIONS = ["pause", "read-only", "isolation"];

export class RemediationError extends Error {
  constructor(message, code = "remediation") {
    super(message);
    this.name = "RemediationError";
    this.code = code;
  }
}

export function allowedRemediationTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertRemediationTransition(from, to) {
  if (!allowedRemediationTransition(from, to)) {
    throw new RemediationError(`ulovlig remediation-overgang ${from} → ${to}`, "illegal-transition");
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Ressourcelease + cooldown                                                  */
/* -------------------------------------------------------------------------- */

export function createMemoryLeaseStore() {
  const leases = new Map();
  return {
    kind: "memory-lease-store",
    read(resource) {
      const value = leases.get(resource);
      return value ? structuredClone(value) : null;
    },
    write(resource, record) {
      leases.set(resource, structuredClone(record));
      return record;
    },
    remove(resource) {
      return leases.delete(resource);
    },
    keys() {
      return [...leases.keys()];
    },
  };
}

/** Filbaseret lease-lager: `wx`-flaget giver gensidig udelukkelse mellem processer. */
export function createFileLeaseStore({ dir, fileStore = null } = {}) {
  if (!dir) throw new Error("createFileLeaseStore kræver en mappe (dir)");
  const fs = fileStore ?? { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync };
  fs.mkdirSync(dir, { recursive: true });
  const pathFor = (resource) => join(dir, `${Buffer.from(String(resource)).toString("hex")}.lease.json`);
  return {
    kind: "file-lease-store",
    dir,
    read(resource) {
      const path = pathFor(resource);
      if (!fs.existsSync(path)) return null;
      try {
        return JSON.parse(fs.readFileSync(path, "utf8"));
      } catch {
        return null;
      }
    },
    write(resource, record) {
      const path = pathFor(resource);
      const tmp = `${path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
      // rename er atomisk på samme filsystem: en læser ser enten før eller efter.
      fs.renameSync(tmp, path);
      return record;
    },
    remove(resource) {
      const path = pathFor(resource);
      if (fs.existsSync(path)) fs.unlinkSync(path);
      return true;
    },
    keys() {
      return [];
    },
  };
}

function resourceKey(resource) {
  return String(resource).trim().toLowerCase();
}

/**
 * Ressourcelease med fencing-token og cooldown. To agenter kan ikke holde
 * samme ressource samtidigt; efter frigivelse kan ressourcen ikke overtages
 * før cooldown er udløbet.
 */
export function createResourceLease({ store = createMemoryLeaseStore(), clock = () => Date.now(), defaultTtlSeconds = 900, defaultCooldownSeconds = 300 } = {}) {
  function state(resource, at = clock()) {
    const record = store.read(resourceKey(resource));
    if (!record) return { resource: resourceKey(resource), held: false, cooldown: false };
    const held = Boolean(record.owner) && record.expiresAt > at;
    const cooldown = !held && record.cooldownUntil != null && record.cooldownUntil > at;
    return { resource: resourceKey(resource), held, cooldown, record };
  }

  function acquire({ resource, owner, ttlSeconds = defaultTtlSeconds, cooldownSeconds = defaultCooldownSeconds, at = clock() } = {}) {
    if (!owner) throw new RemediationError("lease.acquire kræver en owner", "owner-required");
    const key = resourceKey(resource);
    const existing = store.read(key);
    if (existing && existing.owner && existing.expiresAt > at) {
      if (existing.owner === owner) {
        const renewed = { ...existing, expiresAt: at + ttlSeconds * 1000 };
        store.write(key, renewed);
        return { ok: true, refreshed: true, lease: structuredClone(renewed) };
      }
      return { ok: false, reason: "held", holder: existing.owner, lease: structuredClone(existing) };
    }
    if (existing && !existing.owner && existing.cooldownUntil != null && existing.cooldownUntil > at) {
      return { ok: false, reason: "cooldown", cooldownUntil: existing.cooldownUntil, lease: structuredClone(existing) };
    }
    const fencingToken = (existing?.fencingToken ?? 0) + 1;
    const record = {
      resource: key,
      owner,
      fencingToken,
      acquiredAt: at,
      expiresAt: at + ttlSeconds * 1000,
      cooldownUntil: null,
    };
    store.write(key, record);
    return { ok: true, refreshed: false, lease: structuredClone(record) };
  }

  function renew({ resource, owner, fencingToken, ttlSeconds = defaultTtlSeconds, at = clock() } = {}) {
    const key = resourceKey(resource);
    const existing = store.read(key);
    if (!existing || existing.owner !== owner || existing.fencingToken !== fencingToken || existing.expiresAt <= at) return false;
    existing.expiresAt = at + ttlSeconds * 1000;
    store.write(key, existing);
    return true;
  }

  function isValid({ resource, owner, fencingToken, at = clock() } = {}) {
    const existing = store.read(resourceKey(resource));
    return Boolean(existing) && existing.owner === owner && existing.fencingToken === fencingToken && existing.expiresAt > at;
  }

  function release({ resource, owner, fencingToken, cooldownSeconds = defaultCooldownSeconds, at = clock() } = {}) {
    const key = resourceKey(resource);
    const existing = store.read(key);
    if (!existing || existing.owner !== owner || existing.fencingToken !== fencingToken) return false;
    store.write(key, { ...existing, owner: null, releasedAt: at, expiresAt: at, cooldownUntil: at + cooldownSeconds * 1000 });
    return true;
  }

  return { kind: "resource-lease", store, state, acquire, renew, isValid, release };
}

/* -------------------------------------------------------------------------- */
/* Samlet forsøgs-/fejl-/ændringsbudget                                       */
/* -------------------------------------------------------------------------- */

function createMemoryBudgetStore() {
  const events = new Map();
  return {
    kind: "memory-budget-store",
    read(resource) {
      return (events.get(resource) ?? []).map((e) => ({ ...e }));
    },
    append(resource, event) {
      events.set(resource, [...(events.get(resource) ?? []), { ...event }]);
      return event;
    },
    replace(resource, list) {
      events.set(resource, list.map((e) => ({ ...e })));
    },
  };
}

/**
 * Aggregeret budget pr. ressource (og valgfrit pr. kunde). Budgettet deles af
 * alle agenter, så gentagne reparationer ikke kan fortsætte i det uendelige.
 */
export function createRemediationBudget({
  store = createMemoryBudgetStore(),
  clock = () => Date.now(),
  config = { maxAttempts: 5, maxFailures: 2, maxChanges: 3, windowSeconds: 3600 },
} = {}) {
  function prune(resource, at) {
    const cutoff = at - config.windowSeconds * 1000;
    const kept = store.read(resource).filter((e) => e.at >= cutoff);
    store.replace(resource, kept);
    return kept;
  }

  function snapshot({ resource, at = clock() } = {}) {
    const events = prune(resourceKey(resource), at);
    const count = (kind) => events.filter((e) => e.kind === kind).length;
    return {
      resource: resourceKey(resource),
      attempts: count("attempt"),
      failures: count("failure"),
      changes: count("change"),
      limits: { ...config },
      remaining: {
        attempts: Math.max(0, config.maxAttempts - count("attempt")),
        failures: Math.max(0, config.maxFailures - count("failure")),
        changes: Math.max(0, config.maxChanges - count("change")),
      },
    };
  }

  /** Kontrollér om en ny reparation må starte — uden at forbruge noget. */
  function canStart({ resource, at = clock() } = {}) {
    const snap = snapshot({ resource, at });
    const reasons = [];
    if (snap.attempts >= config.maxAttempts) reasons.push(`forsøgsbudgettet er nået (${snap.attempts}/${config.maxAttempts})`);
    if (snap.failures >= config.maxFailures) reasons.push(`fejl-budgettet er nået (${snap.failures}/${config.maxFailures})`);
    if (snap.changes >= config.maxChanges) reasons.push(`ændringsbudgettet er nået (${snap.changes}/${config.maxChanges})`);
    return { ok: reasons.length === 0, reasons, snapshot: snap };
  }

  function consume({ resource, kind, by = null, at = clock() } = {}) {
    if (!["attempt", "failure", "change"].includes(kind)) throw new RemediationError(`ukendt budget-kind '${kind}'`, "unknown-budget-kind");
    const check = canStart({ resource, at });
    if (!check.ok) return { ok: false, reasons: check.reasons, snapshot: check.snapshot };
    store.append(resourceKey(resource), { kind, at, by });
    return { ok: true, snapshot: snapshot({ resource, at }) };
  }

  return { kind: "remediation-budget", store, config, snapshot, canStart, consume };
}

/* -------------------------------------------------------------------------- */
/* Healthchecks af brugerflow og observationstid                             */
/* -------------------------------------------------------------------------- */

/**
 * Observer et brugerflows-healthcheck over en periode.
 *
 * `sampler(check, target, at)` returnerer en numerisk eller boolsk måling.
 * `healthy(reading)` afgør om en måling er acceptabel (standard: tal ≥ baseline
 * − tolerance, boolsk true). Så snart en måling er uacceptabel, er
 * `degraded: true` og `stoppedAt` sat — observationen fortsætter ikke.
 */
export function observeHealth({
  check,
  target,
  samples = null,
  sampler = null,
  baseline = 1,
  tolerance = 0,
  observationSeconds = 60,
  intervalSeconds = 10,
  healthy = null,
  clock = () => Date.now(),
  sleep = null,
} = {}) {
  const isHealthy = typeof healthy === "function" ? healthy : (reading) => (typeof reading === "number" ? reading >= baseline - tolerance : reading === true);
  const readings = [];

  if (Array.isArray(samples)) {
    for (const reading of samples) {
      readings.push(reading);
      if (!isHealthy(reading)) {
        return { check, target, healthy: false, degraded: true, readings, reason: `healthcheck '${check}' forværredes efter ${readings.length} måling(er)` };
      }
    }
    return { check, target, healthy: true, degraded: false, readings, reason: null };
  }

  if (typeof sampler !== "function") {
    return { check, target, healthy: false, degraded: false, readings: [], reason: "ingen sampler konfigureret — kan ikke observere" };
  }

  const steps = Math.max(1, Math.ceil(observationSeconds / intervalSeconds));
  for (let i = 0; i <= steps; i += 1) {
    const at = clock();
    const reading = sampler(check, target, at);
    readings.push(reading);
    if (!isHealthy(reading)) {
      return { check, target, healthy: false, degraded: true, readings, reason: `healthcheck '${check}' forværredes ved måling ${i + 1}` };
    }
    if (i < steps && typeof sleep === "function") sleep(intervalSeconds * 1000);
  }
  return { check, target, healthy: true, degraded: false, readings, reason: null };
}

/* -------------------------------------------------------------------------- */
/* Foruddefineret sikker fallback                                             */
/* -------------------------------------------------------------------------- */

/**
 * Foruddefinerede fallback-handlinger. De er valgt på forhånd af et menneske og
 * må kun reducere adgang. De kræver hverken model eller live PDP, så de kan
 * køre, når AI-ændringer er stoppet.
 */
export function createSafeFallback({ authorizedBy, actions = [], executor, clock = () => Date.now() } = {}) {
  if (!authorizedBy?.subject) throw new RemediationError("safe fallback kræver en navngivet menneskelig autorisation", "fallback-authorization-required");
  const allowed = new Set(actions);
  for (const action of allowed) {
    if (!SAFE_FALLBACK_ACTIONS.includes(action)) throw new RemediationError(`'${action}' er ikke en sikker fallback-handling`, "unsafe-fallback");
  }
  if (typeof executor !== "function") throw new RemediationError("safe fallback kræver en executor", "fallback-executor-required");

  async function run({ reason, resource, tenantId = null } = {}) {
    const executed = [];
    for (const action of allowed) {
      const result = await executor({ action, resource, tenantId, reason, at: new Date(clock()).toISOString() });
      executed.push({ action, ok: result?.ok !== false, summary: result?.summary ?? null, at: new Date(clock()).toISOString() });
    }
    return { ran: executed.map((e) => e.action), executed, authorizedBy: authorizedBy.subject, reason: reason ?? null };
  }

  return { kind: "safe-fallback", actions: [...allowed], authorizedBy: authorizedBy.subject, run };
}

/* -------------------------------------------------------------------------- */
/* Rolleadskillelse                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Fordel rollerne mellem adskilte identiteter. Orkestratoren er deterministisk;
 * det er identiteterne, der bærer rollerne.
 */
export function assertRoleSeparation({ planner = null, executor = null, verifier = null, detector = null } = {}) {
  const errors = [];
  const ids = { planner, executor, verifier, detector };
  for (const [role, agent] of Object.entries(ids)) {
    if (agent && !agent.spiffeId) errors.push({ path: `/${role}`, message: `${role}-identiteten mangler en spiffeId` });
  }
  if (planner && executor && planner.spiffeId === executor.spiffeId) errors.push({ path: "/executor", message: "planlægger og eksekverer må ikke være samme identitet" });
  if (verifier && planner && verifier.spiffeId === planner.spiffeId) errors.push({ path: "/verifier", message: "verifier og planlægger må ikke være samme identitet" });
  if (verifier && executor && verifier.spiffeId === executor.spiffeId) errors.push({ path: "/verifier", message: "verifier og eksekverer må ikke være samme identitet" });
  if (verifier && (planner || executor)) {
    const independent = guardIndependentVerification({ producer: planner ?? executor, verifier });
    for (const e of independent.errors) errors.push({ path: `/verifier${e.path}`, message: e.message });
  }
  return { ok: errors.length === 0, errors };
}

/** Er verbet generelt reversibelt? Irreversible verber er det aldrig. */
export function describeReversibility(verb) {
  const classification = classifyVerb(verb);
  const compensation = compensationFor(verb);
  if (isIrreversibleVerb(verb)) {
    return { verb, reversible: false, classification, compensation: null, fallback: "stop-and-escalate", note: "irreversibel skrivning beskrives ikke som generelt reversibel" };
  }
  if (classification === "read") return { verb, reversible: true, classification, compensation: null, fallback: "none", note: "læsning ændrer intet" };
  return { verb, reversible: true, classification, compensation: compensation ?? null, fallback: compensation ? "compensation" : "stop-and-escalate", note: compensation ? `kompensation: ${compensation}` : "ingen kendt kompensation" };
}

/* -------------------------------------------------------------------------- */
/* Den deterministiske orkestrator                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} deps
 * @param {object} deps.changeService   DKC-045 change-service (resolver + pre-approval).
 * @param {object} deps.agentRuntime    DKC-005/007/011-runtime der udfører én godkendt handling.
 * @param {object} deps.lease           createResourceLease.
 * @param {object} deps.budget          createRemediationBudget.
 * @param {object} deps.auditLog        Beskyttet audit-log (append).
 * @param {object} deps.pdp             PDP-klient (decide).
 * @param {function} deps.diagnose      AI-diagnose (kan fejle på modeludfald).
 * @param {function} deps.propose       AI-forslag → { runbookRef, verb, parameters, evidenceRef }.
 * @param {function} deps.verifier      Uafhængig verifier.
 * @param {function} deps.healthSampler Brugerflows-healthcheck.
 * @param {object} deps.safeFallback    createSafeFallback.
 */
export function createRemediationOrchestrator({
  changeService,
  agentRuntime,
  lease = createResourceLease(),
  budget = createRemediationBudget(),
  auditLog = null,
  pdp = null,
  diagnose = null,
  propose = null,
  verifier = null,
  healthSampler = null,
  safeFallback = null,
  clock = () => Date.now(),
  policy = {},
} = {}) {
  const config = {
    defaultRunbooks: DEFAULT_REMEDIATION_RUNBOOKS,
    observationSeconds: 30,
    cooldownSeconds: 300,
    leaseTtlSeconds: 900,
    budget: budget.config,
    ...policy,
  };

  function newRun(signal) {
    return {
      runId: `rem-${randomUUID()}`,
      resource: signal.target,
      tenantId: signal.tenantId ?? null,
      environment: signal.environment ?? null,
      state: null,
      history: [],
      createdAt: new Date(clock()).toISOString(),
      aiChangesStopped: false,
    };
  }

  async function record(run, type, detail = null) {
    run.history.push({ type, at: new Date(clock()).toISOString(), detail });
    if (auditLog && typeof auditLog.append === "function") {
      // Audit er fail-closed: kan den ikke skrives, stoppes nye agentmutationer.
      return auditLog.append({ id: run.runId, type, at: new Date(clock()).toISOString(), tenantId: run.tenantId, detail });
    }
    return { ok: true };
  }

  function step(run, to, detail = null) {
    if (run.state) assertRemediationTransition(run.state, to);
    run.state = to;
    run.history.push({ type: `state:${to}`, at: new Date(clock()).toISOString(), detail });
  }

  async function safeFallbackRun(run, reason) {
    if (!safeFallback) return null;
    try {
      const result = await safeFallback.run({ reason, resource: run.resource, tenantId: run.tenantId });
      await record(run, "remediation.fallback", { reason, ran: result.ran });
      return result;
    } catch (err) {
      await record(run, "remediation.fallback.failed", { reason, error: err.message });
      return { ran: [], error: err.message };
    }
  }

  /**
   * Kør én afgrænset selvreparation. `signal` bærer mindst:
   * `{ target, environment, tenantId, runbookRef, parameters }`. AI-trinene
   * (`diagnose`, `propose`) og verifikationen er injicerede.
   */
  async function run(signal = {}) {
    const runState = newRun(signal);
    const finish = (state, extra = {}) => {
      if (runState.state !== state) {
        if (runState.state && allowedRemediationTransition(runState.state, state)) step(runState, state);
        else runState.state = state;
      }
      return { ...runState, history: [...runState.history], ...extra };
    };

    step(runState, "detected", { signal: { target: runState.resource, environment: runState.environment, tenantId: runState.tenantId } });
    await record(runState, "remediation.detected", { target: runState.resource });

    // Korrelér: deler vi allerede et aktivt forløb på ressourcen?
    const leaseState = lease.state(runState.resource);
    if (leaseState.held && leaseState.record?.owner !== signal.owner) {
      step(runState, "correlated", { correlatedWith: leaseState.record.owner });
      return finish("cooldown", { reason: `ressourcen '${runState.resource}' repareres allerede af ${leaseState.record.owner}`, holder: leaseState.record.owner });
    }
    step(runState, "correlated", { deduplicated: true });

    // Budget: er der forsøg tilbage på tværs af agenter?
    const budgetCheck = budget.canStart({ resource: runState.resource });
    if (!budgetCheck.ok) return finish("escalated", { reason: `budgettet er opbrugt: ${budgetCheck.reasons.join("; ")}`, budget: budgetCheck.snapshot });

    // Diagnose (AI). Modeludfald stopper AI-ændringer, men en foruddefineret
    // fallback kan fortsætte.
    let diagnosis = signal.diagnosis ?? null;
    if (!diagnosis && typeof diagnose === "function") {
      try {
        diagnosis = await diagnose({ signal, at: new Date(clock()).toISOString() });
      } catch (err) {
        runState.aiChangesStopped = true;
        await record(runState, "remediation.model.failure", { error: err.message });
        const fb = await safeFallbackRun(runState, "model-failure");
        runState.state = "halted";
        return finish("halted", { reason: `modeludfald: ${err.message}`, aiChangesStopped: true, safeFallback: fb });
      }
    }
    step(runState, "diagnosed", { diagnosis: diagnosis ?? null });

    // Forslag. Kun de to initiale runbooks — alt andet kræver særskilt evidens.
    let proposal = signal.proposal ?? null;
    if (!proposal && typeof propose === "function") {
      try {
        proposal = await propose({ signal, diagnosis, at: new Date(clock()).toISOString() });
      } catch (err) {
        runState.aiChangesStopped = true;
        await record(runState, "remediation.model.failure", { error: err.message, phase: "propose" });
        const fb = await safeFallbackRun(runState, "model-failure");
        runState.state = "halted";
        return finish("halted", { reason: `modeludfald under forslag: ${err.message}`, aiChangesStopped: true, safeFallback: fb });
      }
    }
    if (!proposal && (signal.runbookRef || signal.verb)) {
      proposal = { runbookRef: signal.runbookRef ?? null, verb: signal.verb ?? null, parameters: signal.parameters ?? {}, evidenceRef: signal.evidenceRef ?? null };
    }
    if (!proposal) return finish("escalated", { reason: "intet forslag — et menneske må beslutte" });

    const runbookRef = proposal.runbookRef ?? signal.runbookRef ?? null;
    const parameters = proposal.parameters ?? signal.parameters ?? {};
    const verb = proposal.verb ?? signal.verb ?? null;
    const usingDefaultRunbook = config.defaultRunbooks.has(runbookRef);
    if (!usingDefaultRunbook && !proposal.evidenceRef && !signal.evidenceRef) {
      return finish("escalated", { reason: `runbook '${runbookRef}' er ikke en af de to initiale og har ikke særskilt evidens`, runbookRef });
    }
    step(runState, "proposed", { runbookRef, verb, parameters, evidenceRef: proposal.evidenceRef ?? signal.evidenceRef ?? null });

    // Policy: PDP. Tab af governance/styring stopper nye agentmutationer.
    if (pdp && typeof pdp.decide === "function") {
      let decision;
      try {
        decision = await pdp.decide({
          principal: { kind: "agent", id: signal.owner ?? "remediation-orchestrator" },
          action: { verb, target: runState.resource, environment: runState.environment },
          context: { tenantId: runState.tenantId, runbookRef, parameters },
        });
      } catch (err) {
        runState.aiChangesStopped = true;
        await record(runState, "remediation.governance.unavailable", { error: err.message });
        const fb = await safeFallbackRun(runState, "governance-unavailable");
        runState.state = "halted";
        return finish("halted", { reason: `governance utilgængelig: ${err.message}`, aiChangesStopped: true, safeFallback: fb });
      }
      if (decision?.decision === "deny") {
        await record(runState, "remediation.denied", { reasons: decision.reasons ?? [] });
        return finish("escalated", { reason: `policy afviste reparationen: ${(decision.reasons ?? []).join("; ")}` });
      }
    }

    // Runbook-resolver (DKC-045): scope, parametre, forudsætninger, udløb.
    // Runbook-forhåndskontrol (læsende). Den egentlige håndhævelse — scope,
    // parametergrænser, pre-approval, PDP og approval — sker i runtimen via
    // `runbookResolver` (DKC-045). Vi undgår at kalde `resolve` her, da den
    // tager change-kalenderens lås; låsen tages i stedet i runtimens resolve.
    let runbookEntry = null;
    let requiresApproval = signal.approvalId === undefined;
    if (changeService) {
      runbookEntry = typeof changeService.runbookFor === "function" ? changeService.runbookFor(runbookRef) : changeService.getRunbook?.(runbookRef) ?? null;
      if (!runbookEntry) return finish("escalated", { reason: `ukendt runbook '${runbookRef}'` });
      const rb = runbookEntry.runbook;
      if (!scopeCovers(rb, { verb, target: runState.resource, environment: runState.environment, tenantId: runState.tenantId })) {
        return finish("escalated", { reason: `handlingen (${verb} @ ${runState.resource}) ligger uden for runbookens scope` });
      }
      const paramProblems = parameterProblems(rb, parameters);
      if (paramProblems.length) return finish("escalated", { reason: `parametre uden for runbookens grænser: ${paramProblems.map((p) => `${p.path} ${p.message}`).join("; ")}`, runbookReasons: paramProblems });
      if (rb.approval?.flow === "standard" && typeof changeService.getPreApproval === "function") {
        const validity = preApprovalValid(changeService.getPreApproval(runbookEntry.digest), rb, clock());
        requiresApproval = !validity.ok;
      } else {
        requiresApproval = true;
      }
    }
    if (requiresApproval && !signal.approvalId) {
      await record(runState, "remediation.approval.required", { runbookRef });
      return finish("escalated", { reason: "menneskelig godkendelse påkrævet (approvalId mangler)", requiresApproval: true, runbookDigest: runbookEntry?.digest ?? null });
    }
    const resolved = runbookEntry ? { digest: runbookEntry.digest } : null;
    step(runState, "authorized", { runbookRef, runbookDigest: resolved?.digest ?? null, requiresApproval, approvalId: signal.approvalId ?? null });

    // Durable intent: skriv intentionen før nogen ekstern ændring.
    await record(runState, "remediation.intent", { runbookRef, runbookDigest: resolved?.digest ?? null, parameters });
    step(runState, "intent", { runbookRef });

    // Ressourcelease + cooldown.
    const leaseResult = lease.acquire({ resource: runState.resource, owner: signal.owner ?? runState.runId, ttlSeconds: config.leaseTtlSeconds, cooldownSeconds: config.cooldownSeconds, at: clock() });
    if (!leaseResult.ok) {
      runState.state = "cooldown";
      return finish("cooldown", { reason: leaseResult.reason === "cooldown" ? "ressourcen er i cooldown" : `ressourcen holdes af ${leaseResult.holder}`, lease: leaseResult.lease });
    }

    // Forbrug ét forsøg.
    const attempt = budget.consume({ resource: runState.resource, kind: "attempt", by: signal.owner ?? runState.runId });
    if (!attempt.ok) {
      lease.release({ resource: runState.resource, owner: signal.owner ?? runState.runId, fencingToken: leaseResult.lease.fencingToken, at: clock() });
      return finish("escalated", { reason: `budgettet afviste forsøget: ${attempt.reasons.join("; ")}` });
    }

    // Eksekvering gennem den rigtige runtime (verificerer approval, runbook,
    // PDP og A4/AI-immutable igen).
    if (!agentRuntime || typeof agentRuntime.runTask !== "function") {
      lease.release({ resource: runState.resource, owner: signal.owner ?? runState.runId, fencingToken: leaseResult.lease.fencingToken, at: clock() });
      return finish("escalated", { reason: "ingen agentruntime konfigureret" });
    }

    step(runState, "executing", { runbookRef, verb, owner: signal.owner ?? runState.runId });
    const execution = await agentRuntime.runTask({
      apiVersion: "contracts.platform/v1alpha1",
      kind: "AgentTask",
      taskId: runState.runId,
      tenantId: runState.tenantId,
      agentRef: signal.executorAgentRef ?? agentRuntime.manifest?.metadata?.name,
      objective: `selvreparation af ${runState.resource}`,
      changeId: resolved?.changeId ?? undefined,
      actions: [
        {
          verb,
          target: runState.resource,
          environment: runState.environment,
          parameters,
          runbookRef,
          ...(signal.approvalId ? { approvalId: signal.approvalId } : {}),
          ...(signal.changeDigest ? { changeDigest: signal.changeDigest } : {}),
          ...(signal.evidence ? { evidence: signal.evidence } : {}),
          ...(signal.planDigest ? { planDigest: signal.planDigest } : {}),
          ...(resolved?.digest ? { runbookDigest: resolved.digest } : {}),
        },
      ],
    });
    await record(runState, "remediation.executed", { status: execution.status, reason: execution.reason ?? null });

    if (execution.status !== "completed") {
      budget.consume({ resource: runState.resource, kind: "failure", by: signal.owner ?? runState.runId });
      lease.release({ resource: runState.resource, owner: signal.owner ?? runState.runId, fencingToken: leaseResult.lease.fencingToken, at: clock() });
      const state = execution.status === "halted" ? "halted" : "escalated";
      runState.state = state;
      return finish(state, { reason: execution.reason ?? `eksekveringen blev '${execution.status}'`, execution: { status: execution.status } });
    }

    // Uafhængig verifikation.
    step(runState, "verifying", { runbookRef });
    let verification = { verified: true };
    if (typeof verifier === "function") {
      verification = (await verifier({ signal, runState, execution, at: new Date(clock()).toISOString() })) ?? { verified: true };
    }
    const health = observeHealth({
      check: signal.healthCheck ?? "user-flow",
      target: runState.resource,
      samples: signal.healthSamples ?? null,
      sampler: healthSampler,
      baseline: signal.healthBaseline ?? 1,
      tolerance: signal.healthTolerance ?? 0,
      observationSeconds: signal.observationSeconds ?? config.observationSeconds,
      clock,
      sleep: signal.sleep ?? null,
    });
    await record(runState, "remediation.verified", { verified: verification.verified !== false, health: { healthy: health.healthy, degraded: health.degraded, readings: health.readings } });

    if (verification.verified !== false && health.healthy !== false) {
      budget.consume({ resource: runState.resource, kind: "change", by: signal.owner ?? runState.runId });
      lease.release({ resource: runState.resource, owner: signal.owner ?? runState.runId, fencingToken: leaseResult.lease.fencingToken, at: clock() });
      return finish("recovered", { verification, health });
    }

    // Forværring eller fejlet verifikation: kun en autoriseret rollback.
    budget.consume({ resource: runState.resource, kind: "failure", by: signal.owner ?? runState.runId });
    await record(runState, "remediation.degraded", { verification, health });
    const reversibility = describeReversibility(verb);
    if (!reversibility.reversible || !reversibility.compensation) {
      // Ingen generel reversibilitet: stop og overlad til et menneske.
      const fb = await safeFallbackRun(runState, "postcheck-failed-no-rollback");
      runState.state = "escalated";
      return finish("escalated", { reason: `postcheck fejlede og '${verb}' har ingen autoriseret rollback (${reversibility.note})`, verification, health, safeFallback: fb, reversibility });
    }

    // Udfør rollback gennem den rigtige runtime, som selv resolver runbooken
    // og kræver en godkendelse, hvis den ikke er forhåndsgodkendt. Vi kalder
    // ikke `changeService.resolve` her, da det ville forbruge et forsøg og
    // tage en lås for tidligt.
    const rollbackRef = signal.rollbackRunbookRef ?? runbookRef;
    const rollbackExecution = await agentRuntime.runTask({
      apiVersion: "contracts.platform/v1alpha1",
      kind: "AgentTask",
      taskId: `${runState.runId}-rollback`,
      tenantId: runState.tenantId,
      agentRef: signal.executorAgentRef ?? agentRuntime.manifest?.metadata?.name,
      objective: `rollback af ${runState.resource}`,
      actions: [{ verb: reversibility.compensation, target: runState.resource, environment: runState.environment, parameters, runbookRef: rollbackRef, ...(signal.rollbackApprovalId ? { approvalId: signal.rollbackApprovalId } : {}) }],
    });
    lease.release({ resource: runState.resource, owner: signal.owner ?? runState.runId, fencingToken: leaseResult.lease.fencingToken, at: clock() });
    await record(runState, "remediation.rolled_back", { status: rollbackExecution.status });
    if (rollbackExecution.status !== "completed") {
      const fb = await safeFallbackRun(runState, "rollback-failed");
      runState.state = "escalated";
      return finish("escalated", { reason: `rollback fejlede: ${rollbackExecution.reason ?? rollbackExecution.status}`, safeFallback: fb, reversibility });
    }
    return finish("rolled_back", { verification, health, rollback: { status: rollbackExecution.status } });
  }

  return {
    kind: "remediation-orchestrator",
    config,
    lease,
    budget,
    run,
    states: REMEDIATION_STATES,
    transitions: TRANSITIONS,
  };
}
