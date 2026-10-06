/**
 * DKC-029 — semantiske validatorer for support og sagsbehandling.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: en
 * Zammad-baseret kilde med kø-ACL og sikker vedhæftning, en sag med
 * append-only historik, og et svarudkast der er ubetroet, ikke-eksekverbart og
 * kræver en ændringsbunden godkendelse.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { helpdeskSourceProblems, helpdeskPolicyProblems, supportTicketProblems, replyDraftProblems } from "../../helpdesk/src/model.mjs";

function err(path, message) {
  return { path, message };
}

function validateOne(ajv, schemaId, data, rules) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...rules(data));
  return { ok: result.length === 0, errors: result };
}

export function validateHelpdeskSource(data, ajv, { supportedTenants = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.helpdeskSource, data, (d) => helpdeskSourceProblems(d, { supportedTenants }));
}

export function validateSupportTicket(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.supportTicket, data, (d) => supportTicketProblems(d));
}

export function validateReplyDraft(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.replyDraft, data, (d) => replyDraftProblems(d));
}

export function validateHelpdeskPolicy(data) {
  // Politikken har ingen egen kontrakt; den semantiske kontrol står alene.
  const problems = helpdeskPolicyProblems(data);
  return { ok: problems.length === 0, errors: problems };
}
