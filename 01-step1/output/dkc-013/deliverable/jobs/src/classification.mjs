/**
 * DKC-013 — jobklassifikation.
 *
 * Den fælles verbumsklassifikation ligger i `runtime/src/classification.mjs`, så
 * runtime, conformance og jobs bruger præcis samme regel. Her tilføjes kun
 * job-niveauet: en jobpayloads handlinger klassificeres samlet, og den mest
 * risikable klasse vinder.
 */
export {
  ACTION_CLASSES,
  IRREVERSIBLE_WRITES,
  REVERSIBLE_WRITES,
  classifyAction,
  classifyActions,
  classifyVerb,
  compensationFor,
  isIrreversibleVerb,
} from "../../runtime/src/classification.mjs";

import { classifyActions } from "../../runtime/src/classification.mjs";

/** Klassificér et job ud fra payloadens task-handlinger. */
export function classifyJob(job = {}) {
  if (job.classification) return job.classification;
  const actions = job.payload?.task?.actions ?? job.actions ?? [];
  return classifyActions(actions);
}
