/**
 * DKC-058 — deterministiske host-operationer.
 *
 * Hver operation er en lukket funktion. Der findes ingen "kør en kommando" og
 * ingen generisk exec: en operation mapper til præcis én indbygget effekt, og
 * effekten kan kun have de capabilities, operationen må have. En effekt der
 * erklærer at skrive immutable data eller destruere eksterne nøgler afvises,
 * før den overhovedet registreres.
 */
import { createHash } from "node:crypto";
import { MUTATING_HOST_VERBS } from "./model.mjs";

export const EFFECT_CAPABILITIES = {
  diagnose: "read",
  "package-update": "package",
  drain: "availability",
  reboot: "availability",
  "certificate-renew": "certificate",
  "capacity-alert": "read",
};

export const ALLOWED_CAPABILITIES = ["read", "package", "availability", "certificate"];

/** Capabilities der aldrig må optræde i en host-effekt. */
export const FORBIDDEN_CAPABILITIES = ["immutable-write", "external-key-destroy", "broker-config", "package-source", "policy-write", "arbitrary-exec"];

const PARAMETER_ALLOWLIST = {
  diagnose: [],
  "package-update": [],
  drain: ["nodeRef", "reason"],
  reboot: ["nodeRef", "reason", "announcedDowntimeSeconds"],
  "certificate-renew": ["certificateRef", "reason"],
  "capacity-alert": ["thresholds", "reason"],
};

export class OperationError extends Error {
  constructor(message, code = "operation_error") {
    super(message);
    this.name = "OperationError";
    this.code = code;
  }
}

/**
 * Byg en lukket host-adapter. Enhver effekt skal erklære sine capabilities, og
 * forbudte capabilities afvises ved registrering (fail-closed).
 */
export function createHostAdapter({ effects = {} } = {}) {
  const registered = new Map();
  for (const [verb, effect] of Object.entries(effects)) {
    if (!(verb in EFFECT_CAPABILITIES)) throw new OperationError(`ukendt host-effekt '${verb}'`, "unknown_effect");
    const capabilities = Array.isArray(effect?.capabilities) ? effect.capabilities : [];
    for (const cap of capabilities) {
      if (FORBIDDEN_CAPABILITIES.includes(cap)) throw new OperationError(`effekten '${verb}' erklærer den forbudte capability '${cap}'`, "forbidden_capability");
      if (!ALLOWED_CAPABILITIES.includes(cap)) throw new OperationError(`effekten '${verb}' erklærer den ukendte capability '${cap}'`, "unknown_capability");
    }
    if (!capabilities.includes(EFFECT_CAPABILITIES[verb])) {
      throw new OperationError(`effekten '${verb}' mangler sin obligatoriske capability '${EFFECT_CAPABILITIES[verb]}'`, "missing_capability");
    }
    if (typeof effect?.run !== "function") throw new OperationError(`effekten '${verb}' mangler en run-funktion`, "missing_run");
    registered.set(verb, { verb, capabilities, run: effect.run });
  }
  return {
    kind: "host-adapter",
    has: (verb) => registered.has(verb),
    effect: (verb) => registered.get(verb) ?? null,
    verbs: () => [...registered.keys()],
  };
}

/** Deterministisk plan for en operation (dry-run). */
export function planHostOperation({ operation } = {}) {
  const verb = operation?.operation?.verb;
  const steps = [{ id: "preflight", check: "enrollment-and-trust", expect: true }];
  if (MUTATING_HOST_VERBS.includes(verb)) {
    steps.push({ id: "backup-verified", check: "backup", expect: true });
    steps.push({ id: "canary", check: "canary", hostRef: operation.scope?.canary?.hostRef ?? null });
  }
  steps.push({ id: "execute", effect: verb, target: operation.operation.target, parameters: operation.operation.parameters ?? {} });
  if (MUTATING_HOST_VERBS.includes(verb)) steps.push({ id: "postcheck", check: `${verb}-postcheck`, expect: "green" });
  return {
    operationId: operation.operation.id,
    verb,
    dryRun: true,
    deterministicKey: createHash("sha256").update(`${operation.hostRef}:${verb}:${JSON.stringify(operation.operation.parameters ?? {})}`).digest("hex"),
    steps,
  };
}

function parameterProblems(operation) {
  const verb = operation?.operation?.verb;
  const allowed = new Set(PARAMETER_ALLOWLIST[verb] ?? []);
  const problems = [];
  for (const key of Object.keys(operation?.operation?.parameters ?? {})) {
    if (!allowed.has(key)) problems.push(`parameteren '${key}' er ikke tilladt for '${verb}'`);
  }
  return problems;
}

/**
 * Udfør en operation gennem den lukkede adapter. Returnerer en ærlig rapport;
 * en manglende effekt er en fejl, ikke en tavs no-op.
 */
export function runHostOperation({ operation, adapter, now = new Date().toISOString() } = {}) {
  if (!operation) throw new OperationError("runHostOperation kræver en operation", "missing_operation");
  if (!adapter) throw new OperationError("runHostOperation kræver en adapter", "missing_adapter");
  const verb = operation.operation.verb;
  const problems = parameterProblems(operation);
  if (problems.length) throw new OperationError(problems.join("; "), "invalid_parameters");

  const effect = adapter.effect(verb);
  if (!effect) throw new OperationError(`adapteren har ingen effekt for '${verb}'`, "no_effect");
  if (!effect.capabilities.includes(EFFECT_CAPABILITIES[verb])) throw new OperationError(`effekten '${verb}' har ikke den nødvendige capability`, "capability_mismatch");

  const result = effect.run({
    hostRef: operation.hostRef,
    target: operation.operation.target,
    parameters: operation.operation.parameters ?? {},
    package: operation.package ?? null,
    environment: operation.environment,
    tenantId: operation.tenantId,
    approvedBy: operation.approval.humanSubject,
    dryRun: operation.operation.dryRun === true,
  }) ?? {};

  if (result.writesImmutable === true || result.destroysExternalKeys === true) {
    throw new OperationError("host-operationen forsøgte at skrive immutable data eller destruere eksterne nøgler", "immutable_or_key_violation");
  }
  if (result.executedCommand) throw new OperationError("host-operationen forsøgte at køre en arbitrær kommando", "arbitrary_shell");

  return {
    operationId: operation.operation.id,
    hostRef: operation.hostRef,
    verb,
    dryRun: operation.operation.dryRun === true,
    status: result.status ?? "ok",
    detail: result.detail ?? null,
    capabilities: effect.capabilities,
    at: now,
  };
}

export { PARAMETER_ALLOWLIST };
