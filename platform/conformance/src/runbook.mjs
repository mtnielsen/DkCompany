/**
 * DKC-045 — semantiske validatorer for runbooks og changes.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, skemaet
 * ikke kan udtrykke alene:
 *
 *   - en runbook skal være signeret, ikke udløbet, have et lukket scope og en
 *     testet rollback,
 *   - et change må kun stå som implementeret, hvis det har en menneskelig
 *     autorisation, der matcher flowet,
 *   - en standard-change kræver en pre-approval bundet til runbook-digesten,
 *   - en normal-change kræver en konkret godkendelse,
 *   - en emergency-change kræver en særskilt, navngiven menneskelig
 *     autorisation og kan ikke erklære at have omgået A4/AI-immutable,
 *   - runbook-digesten i et change skal matche den faktisk registrerede
 *     runbookversion, når den er kendt.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { runbookProblems, runbookDigest } from "../../approvals/src/runbook.mjs";

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  if (!schemaId) return [];
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

/* -------------------------------------------------------------------------- */
/* Runbook                                                                    */
/* -------------------------------------------------------------------------- */

export function runbookDocumentProblems(data, { now = Date.now(), keyring = null } = {}) {
  return runbookProblems(data, { now, keyring });
}

export function validateRunbook(data, ajv, { now = Date.now(), keyring = null } = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.runbook, data)];
  if (errors.length === 0) errors.push(...runbookDocumentProblems(data, { now, keyring }));
  return { ok: errors.length === 0, errors };
}

/** Validér alle `runbook*.json` i en mappe. */
export function validateRunbookDir(dir, { now = Date.now(), keyring = null } = {}) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => f.startsWith("runbook") && f.endsWith(".json")).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    results.push({ file, ...validateRunbook(data, ajv, { now, keyring }) });
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* Change request                                                             */
/* -------------------------------------------------------------------------- */

const POST_APPROVAL_STATES = new Set(["scheduled", "implementing", "implemented", "rolled_back"]);

export function changeRequestProblems(data, { runbooks = null, now = Date.now() } = {}) {
  const problems = [];
  const flow = data?.flow;
  const state = data?.state;
  const authorization = data?.authorization;

  // Vinduet skal være positivt.
  const start = Date.parse(data?.window?.start ?? "");
  const end = Date.parse(data?.window?.end ?? "");
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) problems.push(err("/window/end", "change-vinduet skal slutte efter det starter"));

  // Runbook-digesten skal matche en kendt runbookversion, når den er kendt.
  if (runbooks) {
    const ref = data?.runbook?.ref;
    const known = ref ? runbooks.get(ref) : undefined;
    if (known && known !== data.runbook.digest) {
      problems.push(err("/runbook/digest", `runbook-digesten matcher ikke den registrerede version '${ref}'`));
    }
  }

  // En autorisation er en navngiven menneskelig beslutning — aldrig en agent.
  if (authorization) {
    if (!authorization.humanSubject || !/^[a-z][a-z0-9-]*\|/.test(authorization.humanSubject)) {
      problems.push(err("/authorization/humanSubject", "autorisationen skal komme fra en verificeret, navngiven menneskelig identitet"));
    }
    const granted = Date.parse(authorization.grantedAt ?? "");
    const expires = Date.parse(authorization.expiresAt ?? "");
    if (Number.isFinite(granted) && Number.isFinite(expires) && expires <= granted) {
      problems.push(err("/authorization/expiresAt", "autorisationen skal udløbe efter den blev givet"));
    }
  }

  // Flow → autorisationskrav.
  if (flow === "standard") {
    const hasPre = Boolean(data?.approval?.preApprovalId || authorization?.kind === "pre-approval");
    if (POST_APPROVAL_STATES.has(state) && !hasPre) {
      problems.push(err("/approval/preApprovalId", "en standard-change kræver en pre-approval bundet til runbook-digesten"));
    }
    if (authorization && authorization.kind !== "pre-approval") {
      problems.push(err("/authorization/kind", "en standard-change skal autoriseres som 'pre-approval'"));
    }
  } else if (flow === "normal") {
    const hasApproval = Boolean(data?.approval?.approvalId || authorization?.kind === "approval");
    if (POST_APPROVAL_STATES.has(state) && !hasApproval) {
      problems.push(err("/approval/approvalId", "en normal-change kræver en konkret, ændringsbundet godkendelse pr. mutation"));
    }
    if (authorization && authorization.kind !== "approval") {
      problems.push(err("/authorization/kind", "en normal-change skal autoriseres som 'approval'"));
    }
  } else if (flow === "emergency") {
    const hasEmergency = Boolean(data?.approval?.approvalId || authorization?.kind === "emergency");
    if (POST_APPROVAL_STATES.has(state) && !hasEmergency) {
      problems.push(err("/authorization", "en emergency-change kræver en særskilt menneskelig autorisation"));
    }
    if (authorization && authorization.kind !== "emergency") {
      problems.push(err("/authorization/kind", "en emergency-change skal autoriseres som 'emergency'"));
    }
    // Emergency må aldrig erklære at have omgået en absolut grænse.
    for (const forbidden of ["bypassA4", "a4Override", "aiImmutableOverride", "skipImmutable", "skipA4"]) {
      if (data?.[forbidden] === true) problems.push(err(`/${forbidden}`, "emergency kan ikke ophæve A4- eller AI-immutable-grænsen"));
    }
  }

  // En lock-owner må ikke være en anden change, når denne står som implementeret.
  if (state === "implemented" && data?.lockOwner && data.lockOwner !== data.id) {
    problems.push(err("/lockOwner", "en afsluttet change må ikke stå med en fremmed låsejer"));
  }

  // Postchecks ved fejl skal enten rulle tilbage eller eskalere.
  for (const [i, post] of (data?.postchecks ?? []).entries()) {
    if (!["rollback", "escalate"].includes(post?.onFailure)) problems.push(err(`/postchecks/${i}/onFailure`, "postcheck ved fejl skal rulle tilbage eller eskalere"));
  }

  return problems;
}

export function validateChangeRequest(data, ajv, { runbooks = null, now = Date.now() } = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.changeRequest, data)];
  if (errors.length === 0) errors.push(...changeRequestProblems(data, { runbooks, now }));
  return { ok: errors.length === 0, errors };
}

/** Validér alle `change-request*.json` i en mappe. */
export function validateChangeRequestDir(dir, { runbooks = null, now = Date.now() } = {}) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => f.startsWith("change-request") && f.endsWith(".json")).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    results.push({ file, ...validateChangeRequest(data, ajv, { runbooks, now }) });
  }
  return results;
}

/** Byg et ref → digest-kort ud fra kendte runbook-eksempler. */
export function knownRunbooksFromExamples(examplesDir) {
  const map = new Map();
  if (!examplesDir || !existsSync(examplesDir)) return map;
  for (const file of readdirSync(examplesDir).filter((f) => f.startsWith("runbook") && f.endsWith(".json")).sort()) {
    try {
      const data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
      if (data?.metadata?.name && data?.metadata?.version) map.set(`${data.metadata.name}@${data.metadata.version}`, runbookDigest(data));
    } catch {
      /* spring ugyldig JSON over; runbook-validatoren rapporterer den */
    }
  }
  return map;
}
