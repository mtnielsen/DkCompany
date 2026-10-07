/**
 * DKC-060 — semantiske validatorer for tværgående IAM og dataadgang.
 *
 * Skemaerne håndhæver formen. Denne modul håndhæver beslutningerne:
 *   - en funktionsprofil er default-deny, kræver platform-core, dækker alle
 *     syv flader og må ikke tillade et beskyttet felt uden en bevilling,
 *   - en rapportdefinition bærer en identitet — ikke et token — og en
 *     autoritativ definition der matcher datakilden,
 *   - en rapportkørsel kan kun være `run` når afsender og alle modtagere blev
 *     revalideret positivt og der ikke blev brugt et gemt creator-token,
 *   - en offboardingplan kan kun være `complete` når alle fem rettighedsklasser
 *     er lukket inden fristen.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { featureProfileProblems } from "../../feature-access/src/profiles.mjs";
import { reportDefinitionProblems } from "../../feature-access/src/reporting.mjs";
import { offboardingPlanProblems } from "../../feature-access/src/offboarding.mjs";

function err(path, message) {
  return { path, message };
}

function schemaAndSemantic(ajvInstance, schemaId, data, semantic) {
  const instance = ajvInstance ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...semantic(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Funktionsprofil                                                            */
/* -------------------------------------------------------------------------- */

export function validateFeatureProfile(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.featureProfile, data, featureProfileProblems);
}

/* -------------------------------------------------------------------------- */
/* Rapportdefinition                                                          */
/* -------------------------------------------------------------------------- */

export function validateReportDefinition(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.reportDefinition, data, reportDefinitionProblems);
}

/* -------------------------------------------------------------------------- */
/* Rapportkørsel                                                              */
/* -------------------------------------------------------------------------- */

export function reportRunProblems(run) {
  const problems = [];
  if (!run || typeof run !== "object") return [err("/", "rapportkørslen er ikke et objekt")];
  const recipients = run.recipients ?? [];
  const denied = recipients.filter((r) => r.decision !== "allow");
  if (run.authorization?.usedStoredCreatorToken !== false) {
    problems.push(err("/authorization/usedStoredCreatorToken", "en kørsel må ikke genbruge et gemt creator-token"));
  }
  if (run.decision === "run") {
    if (run.sender?.decision !== "allow") problems.push(err("/decision", "en 'run'-kørsel kræver at afsenderen blev revalideret positivt"));
    if (denied.length) problems.push(err("/decision", `en 'run'-kørsel må ikke have afviste modtagere (${denied.map((r) => r.id).join(", ")})`));
    if (run.authorization?.senderResolved !== true || run.authorization?.recipientsResolved !== true) {
      problems.push(err("/authorization", "en 'run'-kørsel kræver at afsender og modtagere faktisk blev genoprettet"));
    }
    for (const [i, recipient] of recipients.entries()) {
      if (!recipient.deliveredAt) problems.push(err(`/recipients/${i}/deliveredAt`, "en leveret rapport skal have et leveringstidspunkt"));
    }
  }
  if (run.decision === "reauthorize" && run.sender?.decision === "allow") {
    problems.push(err("/decision", "en 'reauthorize'-kørsel skal have et bortfaldet afsendergrundlag"));
  }
  if (run.decision === "blocked" && denied.length === 0) {
    problems.push(err("/decision", "en 'blocked'-kørsel skal navngive mindst én afvist modtager"));
  }
  return problems;
}

export function validateReportRun(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.reportRun, data, reportRunProblems);
}

/* -------------------------------------------------------------------------- */
/* Offboardingplan                                                            */
/* -------------------------------------------------------------------------- */

export function validateOffboardingPlan(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.offboardingPlan, data, offboardingPlanProblems);
}
