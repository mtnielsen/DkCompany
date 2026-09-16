/**
 * 4.1 — Ejer-curriculum.
 *
 * Curriculumet er bygget på rigtige approval-payloads: hvert scenarie tager en
 * committet approval-request og muterer den via sti-overrides. Forslag, der
 * skal afvises, bærer deterministiske afvisningskriterier, så scenariet kan
 * tjekkes i CI. Gennemførelse logges som CloudEvent og håndhæves af
 * approval-servicen (2.4) gennem trainingRegistry.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkClaims } from "../../approvals/src/claims.mjs";

export const MODULE_COMPLETED_TYPE = "dk.platform.curriculum.module.completed";

export function loadCurriculum(root) {
  return JSON.parse(readFileSync(join(root, "curriculum", "curriculum.json"), "utf8"));
}

export function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let cursor = obj;
  for (const key of keys) {
    if (cursor[key] == null || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[last] = value;
}

export function applyOverrides(base, overrides = {}) {
  const clone = structuredClone(base);
  for (const [path, value] of Object.entries(overrides)) setPath(clone, path, value);
  return clone;
}

export function criterionHolds(actual, operator, value) {
  switch (operator) {
    case "eq": return actual === value;
    case "neq": return actual !== value;
    case "lt": return typeof actual === "number" && actual < value;
    case "lte": return typeof actual === "number" && actual <= value;
    case "gt": return typeof actual === "number" && actual > value;
    case "gte": return typeof actual === "number" && actual >= value;
    default: return false;
  }
}

/**
 * Validerer curriculumet mod kontrakten, hvert scenaries payload mod
 * approval-request, og at afvisningskriterierne faktisk holder. Et scenarie,
 * hvor agentens påstande ikke matcher evidensen, må ikke være et approve.
 */
export function validateCurriculum(curriculum, { root, ajv, validateApproval, validateCurriculumSchema }) {
  const problems = [];
  const schemaResult = validateCurriculumSchema(curriculum);
  if (!schemaResult.ok) {
    return { ok: false, problems: schemaResult.errors.map((e) => `curriculum: ${(e.path || "/").trim()} ${e.message}`), scenarios: [] };
  }

  const baseCache = new Map();
  const loadBase = (name) => {
    if (!baseCache.has(name)) {
      const ref = curriculum.basePayloads?.[name];
      if (!ref) throw new Error(`Ukendt basePayload '${name}'`);
      baseCache.set(name, JSON.parse(readFileSync(join(root, ref), "utf8")));
    }
    return baseCache.get(name);
  };

  const scenarios = [];
  let mustReject = 0;
  const seen = new Set();

  for (const module of curriculum.modules) {
    for (const scenario of module.scenarios) {
      if (seen.has(scenario.id)) problems.push(`scenarie-id '${scenario.id}' er brugt flere gange`);
      seen.add(scenario.id);

      let payload;
      try {
        payload = applyOverrides(loadBase(scenario.base), scenario.overrides);
      } catch (err) {
        problems.push(`${scenario.id}: ${err.message}`);
        continue;
      }
      const approvalResult = validateApproval(payload);
      if (!approvalResult.ok) {
        problems.push(`${scenario.id}: payload matcher ikke approval-request: ${approvalResult.errors[0]?.message ?? "ukendt fejl"}`);
        continue;
      }

      const claims = checkClaims(payload);
      if (scenario.expectedVerdict === "reject") {
        if (!scenario.mustReject) problems.push(`${scenario.id}: reject-scenarie mangler mustReject`);
        for (const criterion of scenario.rejectionCriteria ?? []) {
          const actual = getPath(payload, criterion.path);
          if (!criterionHolds(actual, criterion.operator, criterion.value)) {
            problems.push(
              `${scenario.id}: afvisningskriterium '${criterion.path} ${criterion.operator} ${JSON.stringify(criterion.value)}' holder ikke (faktisk ${JSON.stringify(actual)})`
            );
          }
        }
        mustReject += 1;
      } else {
        for (const criterion of scenario.rejectionCriteria ?? []) {
          if (criterionHolds(getPath(payload, criterion.path), criterion.operator, criterion.value)) {
            problems.push(`${scenario.id}: approve-scenarie opfylder afvisningskriteriet '${criterion.path}'`);
          }
        }
        if (!claims.ok) problems.push(`${scenario.id}: approve-scenarie har påstande, der ikke matcher evidensen`);
      }

      scenarios.push({ moduleId: module.id, moduleTitle: module.title, scenario, payload, claims });
    }
  }

  if (mustReject === 0) problems.push("curriculumet har ingen forslag, der skal afvises");
  return { ok: problems.length === 0, problems, scenarios };
}

/** CloudEvents for gennemførte moduler. Håndhæves af approval-servicen (2.4). */
export function complete({ subject, moduleIds, at, curriculumVersion = "1.0.0", traceId = "0".repeat(32), tenantId = "platform" }) {
  if (!subject) throw new Error("subject kræves");
  if (!moduleIds?.length) throw new Error("mindst ét modul kræves");
  const time = at ?? new Date().toISOString();
  return moduleIds.map((moduleId) => ({
    specversion: "1.0",
    id: randomUUID(),
    source: "urn:platform:curriculum",
    type: MODULE_COMPLETED_TYPE,
    time,
    datacontenttype: "application/json",
    tenantid: tenantId,
    traceid: traceId,
    principal: { kind: "human", id: subject },
    dataclassification: "operational",
    data: { moduleId, curriculumVersion },
  }));
}

/** Bygger et trainingRegistry (2.4) ud fra gennemførelses-events. */
export function trainingRegistryFromEvents(events, { curriculumVersion } = {}) {
  const bySubject = new Map();
  for (const event of events ?? []) {
    if (event.type !== MODULE_COMPLETED_TYPE) continue;
    if (curriculumVersion && event.data?.curriculumVersion !== curriculumVersion) continue;
    const set = bySubject.get(event.principal?.id) ?? new Set();
    set.add(event.data?.moduleId);
    bySubject.set(event.principal?.id, set);
  }
  return (subject) => [...(bySubject.get(subject) ?? [])];
}
