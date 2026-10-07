/**
 * DKC-046 — semantiske validatorer for selvreparation.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, skemaet
 * ikke kan udtrykke alene:
 *
 *   - tilstandsovergange følger den deterministiske state machine,
 *   - kun de to forhåndsgodkendte runbooks (eller en runbook med særskilt
 *     evidens) bruges,
 *   - en irreversibel handling beskrives ikke som generelt reversibel,
 *   - fallback-handlinger er blandt de foruddefinerede sikre handlinger,
 *   - rollerne er adskilte identiteter,
 *   - en lease er tidsbegrænset med monotonisk fencing-token og cooldown,
 *   - en health-observation er degraderet, hvis en måling er under tærsklen.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { SAFE_FALLBACK_ACTIONS, DEFAULT_REMEDIATION_RUNBOOKS, allowedRemediationTransition, describeReversibility } from "../../runtime/src/remediation.mjs";
import { runbookDigest } from "../../approvals/src/runbook.mjs";

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  if (!schemaId) return [];
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

/* -------------------------------------------------------------------------- */
/* Remediation-plan                                                           */
/* -------------------------------------------------------------------------- */

export function remediationPlanProblems(plan, { runbooks = null } = {}) {
  const problems = [];
  const states = (plan?.states ?? []).map((s) => s.state);

  // Tilstandsovergange.
  for (let i = 1; i < states.length; i += 1) {
    if (!allowedRemediationTransition(states[i - 1], states[i])) {
      problems.push(err(`/states/${i}/state`, `ulovlig overgang ${states[i - 1]} → ${states[i]}`));
    }
  }
  const last = states[states.length - 1];
  if (plan?.outcome?.state && last && plan.outcome.state !== last) {
    problems.push(err("/outcome/state", `outcome '${plan.outcome.state}' matcher ikke den sidste tilstand '${last}'`));
  }
  if (plan?.outcome?.state === "halted" && plan?.aiChangesStopped !== true) {
    problems.push(err("/aiChangesStopped", "en halted kørsel skal markere at AI-ændringer er stoppet"));
  }

  // Kun de initiale runbooks uden særskilt evidens.
  const ref = plan?.runbook?.ref;
  const hasEvidence = Boolean(plan?.runbook?.evidenceRef);
  if (ref && !DEFAULT_REMEDIATION_RUNBOOKS.has(ref) && !hasEvidence) {
    problems.push(err("/runbook/ref", `runbook '${ref}' er ikke en af de to initiale og har ikke særskilt evidens`));
  }
  if (runbooks && ref && runbooks.has(ref) && plan?.runbook?.digest && runbooks.get(ref) !== plan.runbook.digest) {
    problems.push(err("/runbook/digest", `runbook-digesten matcher ikke den registrerede version '${ref}'`));
  }

  // Reversibilitet må ikke overdrives.
  const verb = plan?.reversibility?.verb;
  if (verb) {
    const computed = describeReversibility(verb);
    if (plan.reversibility.reversible !== computed.reversible) {
      problems.push(err("/reversibility/reversible", `'${verb}' er ${computed.reversible ? "reversibel" : "irreversibel"} — beskrivelsen er forkert`));
    }
    if (computed.reversible === false && plan.reversibility.fallback !== "stop-and-escalate") {
      problems.push(err("/reversibility/fallback", "en irreversibel handling skal falde til 'stop-and-escalate'"));
    }
    if (computed.reversible === false && plan.reversibility.compensation) {
      problems.push(err("/reversibility/compensation", "en irreversibel handling har ingen kompensation"));
    }
  }

  // Fallback-handlinger skal være foruddefinerede og sikre.
  for (const [i, action] of (plan?.fallback?.actions ?? []).entries()) {
    if (!SAFE_FALLBACK_ACTIONS.includes(action)) problems.push(err(`/fallback/actions/${i}`, `'${action}' er ikke en sikker fallback-handling`));
  }

  // Rollerne skal være adskilte identiteter.
  const roles = plan?.roles ?? {};
  const identities = Object.entries(roles).filter(([, v]) => v?.spiffeId);
  for (let i = 0; i < identities.length; i += 1) {
    for (let j = i + 1; j < identities.length; j += 1) {
      if (identities[i][1].spiffeId === identities[j][1].spiffeId) {
        problems.push(err("/roles", `rollerne '${identities[i][0]}' og '${identities[j][0]}' er samme identitet`));
      }
    }
  }

  return problems;
}

export function validateRemediationPlan(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.remediationPlan, data)];
  if (errors.length === 0) errors.push(...remediationPlanProblems(data, opts));
  return { ok: errors.length === 0, errors };
}

export function validateRemediationPlanDir(dir, opts = {}) {
  return validateDir(dir, "remediation-plan", SCHEMA_IDS.remediationPlan, (data, instance) => validateRemediationPlan(data, instance, opts));
}

/* -------------------------------------------------------------------------- */
/* Resource lease                                                             */
/* -------------------------------------------------------------------------- */

export function resourceLeaseProblems(lease) {
  const problems = [];
  const acquired = Date.parse(lease?.acquiredAt ?? "");
  const expires = Date.parse(lease?.expiresAt ?? "");
  if (Number.isFinite(acquired) && Number.isFinite(expires) && expires <= acquired) {
    problems.push(err("/expiresAt", "leasen skal udløbe efter den blev taget"));
  }
  if (lease?.releasedAt) {
    const released = Date.parse(lease.releasedAt);
    if (Number.isFinite(expires) && released < acquired) problems.push(err("/releasedAt", "frigivelse kan ikke ligge før anskaffelsen"));
  }
  if (lease?.cooldownUntil) {
    const cooldown = Date.parse(lease.cooldownUntil);
    if (Number.isFinite(expires) && cooldown < expires) problems.push(err("/cooldownUntil", "cooldown skal ligge efter udløb"));
  }
  if (lease?.held === true && !lease?.owner) problems.push(err("/owner", "en holdt lease skal have en ejer"));
  return problems;
}

export function validateResourceLease(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.resourceLease, data)];
  if (errors.length === 0) errors.push(...resourceLeaseProblems(data));
  return { ok: errors.length === 0, errors };
}

export function validateResourceLeaseDir(dir) {
  return validateDir(dir, "resource-lease", SCHEMA_IDS.resourceLease, (data, instance) => validateResourceLease(data, instance));
}

/* -------------------------------------------------------------------------- */
/* Health observation                                                         */
/* -------------------------------------------------------------------------- */

export function healthObservationProblems(obs) {
  const problems = [];
  const readings = obs?.readings ?? [];
  const isHealthy = (r) => (typeof r === "number" ? r >= (obs?.baseline ?? 1) - (obs?.tolerance ?? 0) : r === true);
  const degraded = readings.some((r) => !isHealthy(r));
  if (obs?.degraded !== degraded) problems.push(err("/degraded", "degraded-flaget stemmer ikke med målingerne"));
  if (obs?.healthy === true && degraded) problems.push(err("/healthy", "en degraderet observation kan ikke være healthy"));
  if (degraded && !obs?.reason) problems.push(err("/reason", "en degraderet observation skal have en begrundelse"));
  if ((obs?.observationSeconds ?? 0) <= 0) problems.push(err("/observationSeconds", "observationsvinduet skal være positivt"));
  if ((obs?.intervalSeconds ?? 0) <= 0) problems.push(err("/intervalSeconds", "intervallet skal være positivt"));
  return problems;
}

export function validateHealthObservation(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.healthObservation, data)];
  if (errors.length === 0) errors.push(...healthObservationProblems(data));
  return { ok: errors.length === 0, errors };
}

export function validateHealthObservationDir(dir) {
  return validateDir(dir, "health-observation", SCHEMA_IDS.healthObservation, (data, instance) => validateHealthObservation(data, instance));
}

/* -------------------------------------------------------------------------- */
/* Hjælpere                                                                   */
/* -------------------------------------------------------------------------- */

function validateDir(dir, prefix, schemaId, run) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    results.push({ file, ...run(data, ajv) });
  }
  return results;
}

/** Byg et ref → digest-kort ud fra kendte runbook-dokumenter (fx runbooks/). */
export function knownRemediationRunbooks(root) {
  const map = new Map();
  const dir = join(root, "runbooks");
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".runbook.json")).sort()) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (data?.metadata?.name && data?.metadata?.version) map.set(`${data.metadata.name}@${data.metadata.version}`, runbookDigest(data));
    } catch {
      /* ignoreres; runbook-validatoren rapporterer */
    }
  }
  return map;
}
