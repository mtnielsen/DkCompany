/**
 * DKC-063 — semantiske validatorer for testmatrix, trusselmodel, risikoundtagelser,
 * uafhængige vurderinger og release-gate-resultatet.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke alene:
 *
 *   - hvert krav har en navngivet menneskelig ejer og dækker alle de testtyper
 *     det erklærer,
 *   - et obligatorisk krav uden checks SKAL have en eksplicit uafhængig vurdering,
 *   - tærskler kræver en navngivet menneskelig accept og en frisk frist,
 *   - trusselmodellen dækker præcis de syv testede grænser,
 *   - en risikoundtagelse udløber og har kompenserende kontroller,
 *   - en uafhængig vurdering er udført af et navngivet menneske og udløber,
 *   - et gate-resultat tæller kun 'passed' som bestået, og en blokerende
 *     beslutning hænger sammen med de blokerende krav.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

function err(path, message) {
  return { path, message };
}

function validateOne(ajv, schemaId, data, rules) {
  const { ok, errors } = validate(ajv, schemaId, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...rules(data));
  return { ok: result.length === 0, errors: result };
}

export const BOUNDARIES = [
  "tenant-boundary",
  "identity",
  "agent-handoff",
  "privileged-host-operations",
  "immutable-storage",
  "telemetry",
  "external-sources",
];

/* -------------------------------------------------------------------------- */
/* Test matrix                                                                */
/* -------------------------------------------------------------------------- */

export function testMatrixProblems(data) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "matrixen skal have et navngivet menneske som ejer"));
  }
  const thresholds = data?.thresholds ?? {};
  if (!isNamedHuman(thresholds.acceptedBy)) {
    problems.push(err("/thresholds/acceptedBy", "tærsklerne skal være accepteret af et navngivet menneske før release"));
  }
  if (!(thresholds.acceptedAt ?? "").trim()) {
    problems.push(err("/thresholds/acceptedAt", "tærsklerne mangler et accepttidspunkt"));
  }

  const stageIds = new Set();
  for (const [i, stage] of (data?.stages ?? []).entries()) {
    if (stageIds.has(stage.id)) problems.push(err(`/stages/${i}/id`, `dubleret trin-id '${stage.id}'`));
    stageIds.add(stage.id);
  }

  const maxDays = data?.freshnessPolicy?.maxDays ?? Infinity;
  const reqIds = new Set();
  for (const [i, r] of (data?.requirements ?? []).entries()) {
    const at = (suffix) => `/requirements/${i}${suffix}`;
    if (reqIds.has(r.id)) problems.push(err(at("/id"), `dubleret krav-id '${r.id}'`));
    reqIds.add(r.id);
    if (!isNamedHuman(r.owner)) problems.push(err(at("/owner"), `kravet '${r.id}' skal have et navngivet menneske som ejer`));
    if (Number(r.evidenceFreshnessDays) > maxDays) {
      problems.push(err(at("/evidenceFreshnessDays"), `kravet '${r.id}' har en frist der overskrider freshnessPolicy.maxDays (${maxDays})`));
    }
    const checkIds = new Set();
    const covered = new Set();
    for (const c of r.checks ?? []) {
      if (checkIds.has(c.id)) problems.push(err(at("/checks"), `kravet '${r.id}' gentager check '${c.id}'`));
      checkIds.add(c.id);
      for (const t of c.testTypes ?? []) covered.add(t);
    }
    const missing = r.independentAssessment?.required === true ? [] : (r.testTypes ?? []).filter((t) => !covered.has(t));
    if (missing.length) {
      problems.push(err(at("/testTypes"), `kravet '${r.id}' erklærer testtyper uden en check: ${missing.join(", ")}`));
    }
    const hasAssessment = r.independentAssessment?.required === true;
    if (r.mandatory === true && (r.checks ?? []).length === 0 && !hasAssessment) {
      problems.push(err(at("/checks"), `det obligatoriske krav '${r.id}' mangler både en check og en uafhængig vurdering`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Threat register                                                            */
/* -------------------------------------------------------------------------- */

export function threatRegisterProblems(data, { requirementIds } = {}) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "trusselmodellen skal have et navngivet menneske som ejer"));
  }
  const declared = (data?.boundaries ?? []).map((b) => b.id);
  for (const id of BOUNDARIES) {
    if (!declared.includes(id)) problems.push(err("/boundaries", `trusselmodellen mangler grænsen '${id}'`));
  }
  for (const id of declared) {
    if (!BOUNDARIES.includes(id)) problems.push(err("/boundaries", `ukendt grænse '${id}'`));
  }
  if (new Set(declared).size !== declared.length) problems.push(err("/boundaries", "dublerede grænser"));

  const ids = new Set();
  for (const [i, t] of (data?.threats ?? []).entries()) {
    if (ids.has(t.id)) problems.push(err(`/threats/${i}/id`, `dubleret trussel-id '${t.id}'`));
    ids.add(t.id);
    if (!declared.includes(t.boundary)) problems.push(err(`/threats/${i}/boundary`, `truslen '${t.id}' peger på en ukendt grænse`));
    if (!isNamedHuman(t.owner)) problems.push(err(`/threats/${i}/owner`, `truslen '${t.id}' skal have et navngivet menneske som ejer`));
    if (requirementIds) {
      for (const rid of t.requirementIds ?? []) {
        if (!requirementIds.has(rid)) problems.push(err(`/threats/${i}/requirementIds`, `truslen '${t.id}' peger på et ukendt krav '${rid}'`));
      }
    }
  }
  for (const b of data?.boundaries ?? []) {
    if (requirementIds) {
      for (const rid of b.requirementIds ?? []) {
        if (!requirementIds.has(rid)) problems.push(err("/boundaries", `grænsen '${b.id}' peger på et ukendt krav '${rid}'`));
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Risk exceptions                                                            */
/* -------------------------------------------------------------------------- */

export function riskExceptionProblems(data, { requirementIds } = {}) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "undtagelsesregisteret skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  for (const [i, e] of (data?.exceptions ?? []).entries()) {
    if (ids.has(e.id)) problems.push(err(`/exceptions/${i}/id`, `dubleret undtagelses-id '${e.id}'`));
    ids.add(e.id);
    if (!isNamedHuman(e.owner)) problems.push(err(`/exceptions/${i}/owner`, `undtagelsen '${e.id}' skal have et navngivet menneske som ejer`));
    const approved = Date.parse(e.approvedAt);
    const expires = Date.parse(e.expiresAt);
    if (!Number.isFinite(approved) || !Number.isFinite(expires)) problems.push(err(`/exceptions/${i}`, `undtagelsen '${e.id}' mangler gyldige tidsstempler`));
    else if (expires <= approved) problems.push(err(`/exceptions/${i}/expiresAt`, `undtagelsen '${e.id}' udløber før den er godkendt`));
    if (!(e.compensatingControls ?? []).length) problems.push(err(`/exceptions/${i}/compensatingControls`, `undtagelsen '${e.id}' kræver mindst én kompenserende kontrol`));
    if (requirementIds && !requirementIds.has(e.requirementId)) problems.push(err(`/exceptions/${i}/requirementId`, `undtagelsen '${e.id}' peger på et ukendt krav '${e.requirementId}'`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Independent assessments                                                    */
/* -------------------------------------------------------------------------- */

export function independentAssessmentProblems(data, { requirementIds } = {}) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "vurderingsregisteret skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  for (const [i, a] of (data?.assessments ?? []).entries()) {
    if (ids.has(a.id)) problems.push(err(`/assessments/${i}/id`, `dubleret vurderings-id '${a.id}'`));
    ids.add(a.id);
    if (!isNamedHuman(a.performedBy)) problems.push(err(`/assessments/${i}/performedBy`, `vurderingen '${a.id}' skal være udført af et navngivet menneske`));
    const performed = Date.parse(a.performedAt);
    const expires = Date.parse(a.expiresAt);
    if (!Number.isFinite(performed) || !Number.isFinite(expires)) problems.push(err(`/assessments/${i}`, `vurderingen '${a.id}' mangler gyldige tidsstempler`));
    else if (expires <= performed) problems.push(err(`/assessments/${i}/expiresAt`, `vurderingen '${a.id}' udløber før den er udført`));
    if (requirementIds && !requirementIds.has(a.requirementId)) problems.push(err(`/assessments/${i}/requirementId`, `vurderingen '${a.id}' peger på et ukendt krav '${a.requirementId}'`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Release gate result                                                        */
/* -------------------------------------------------------------------------- */

export function releaseGateResultProblems(data) {
  const problems = [];
  const reqs = data?.requirements ?? [];
  const statuses = data?.statuses ?? {};
  if (statuses.total !== reqs.length) problems.push(err("/statuses/total", "total matcher ikke antallet af krav"));
  const count = (s) => reqs.filter((r) => r.status === s).length;
  if (statuses.passed !== count("passed")) problems.push(err("/statuses/passed", "passed tæller ikke kun 'passed'"));
  if (statuses.failed !== count("failed")) problems.push(err("/statuses/failed", "failed stemmer ikke"));
  if (statuses.stale !== count("stale")) problems.push(err("/statuses/stale", "stale stemmer ikke"));
  if (statuses.wrongArtifact !== count("wrong-artifact")) problems.push(err("/statuses/wrongArtifact", "wrong-artifact stemmer ikke"));
  const blocking = reqs.filter((r) => r.blocking === true).length;
  if (statuses.blocking !== blocking) problems.push(err("/statuses/blocking", "blocking stemmer ikke med antallet af blokerende krav"));
  if (blocking > 0 && data?.decision === "eligible") problems.push(err("/decision", "en eligible beslutning kan ikke have blokerende krav"));
  if (blocking === 0 && data?.decision === "blocked") problems.push(err("/decision", "en blocked beslutning skal have mindst ét blokerende krav"));
  for (const [i, r] of reqs.entries()) {
    const passed = r.status === "passed";
    if (r.blocking === true && passed === true && r.releaseBlocking !== true) continue;
    if (r.blocking === true && (r.reasons ?? []).length === 0) problems.push(err(`/requirements/${i}/reasons`, `det blokerende krav '${r.requirementId}' mangler en begrundelse`));
    if (r.blocking === true && r.releaseBlocking !== true) problems.push(err(`/requirements/${i}/blocking`, `kravet '${r.requirementId}' blokerer uden at være releaseBlocking`));
  }
  if (!(data?.producer?.name ?? "").trim() || !(data?.producer?.subject ?? "").trim()) {
    problems.push(err("/producer", "producenten skal være navngivet med subject"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Wrappers                                                                   */
/* -------------------------------------------------------------------------- */

export function validateTestMatrix(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.testMatrix, data, testMatrixProblems);
}
export function validateThreatRegister(data, ajv, opts) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.threatRegister, data, (d) => threatRegisterProblems(d, opts));
}
export function validateRiskExceptions(data, ajv, opts) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.riskException, data, (d) => riskExceptionProblems(d, opts));
}
export function validateIndependentAssessments(data, ajv, opts) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.independentAssessment, data, (d) => independentAssessmentProblems(d, opts));
}
export function validateReleaseGateResult(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  return validateOne(instance, SCHEMA_IDS.releaseGateResult, data, releaseGateResultProblems);
}
