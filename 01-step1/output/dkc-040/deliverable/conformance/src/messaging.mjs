/**
 * DKC-040 — semantiske validatorer for den holdbare beskedudveksling.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne: holdbar
 * broker med quorum og publisher confirms, transaktionel outbox, dedup og
 * logisk rækkefølge i inboxen, fencing for singletonjobs, synlig backpressure,
 * poison-isolation pr. tenant og en ærlig at-least-once-garanti. Validatoren
 * erstatter ikke en rigtig broker.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { messagingTopologyProblems } from "../../jobs/src/topology.mjs";

function err(path, message) {
  return { path, message };
}

export function validateMessagingTopology(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.messagingTopology, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...messagingTopologyProblems(data));
  return { ok: problems.length === 0, errors: problems };
}

export function validateOutboxRecord(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.outboxRecord, data);
  return { ok, errors: ok ? [] : errors.map((e) => err(e.path || "/", e.message)) };
}
