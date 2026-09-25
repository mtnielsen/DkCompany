/**
 * DKC-028 — semantiske validatorer for rettighedsbevidst videnssøgning.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: en read-only,
 * tenantbundet kilde, et dokument med tenant/klassifikation/ACL, og et svar der
 * er ubetroet, kildehenvist og aldrig aktiverer et værktøj.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { knowledgeSourceProblems, searchIndexPolicyProblems, knowledgeDocumentProblems, retrievalAnswerProblems } from "../../search/src/model.mjs";

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

export function validateKnowledgeSource(data, ajv, { supportedTenants = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.knowledgeSource, data, (d) => knowledgeSourceProblems(d, { supportedTenants }));
}

export function validateKnowledgeDocument(data, ajv, { source = null } = {}) {
  return validateOne(ajv, SCHEMA_IDS.knowledgeDocument, data, (d) => knowledgeDocumentProblems(d, { source }));
}

export function validateSearchIndexPolicy(data, ajv) {
  // Politikken har ingen egen kontrakt; den semantiske kontrol står alene.
  const problems = searchIndexPolicyProblems(data);
  return { ok: problems.length === 0, errors: problems };
}

export function validateRetrievalAnswer(data, ajv) {
  return validateOne(ajv, SCHEMA_IDS.retrievalAnswer, data, (d) => retrievalAnswerProblems(d));
}
