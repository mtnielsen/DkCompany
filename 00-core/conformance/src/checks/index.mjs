import { schemaValid, verbsDeclared } from "./contract.mjs";
import { verbHonesty, evidenceResolvable } from "./honesty.mjs";
import { identityNoLocalStore, telemetryEnvelope, cloudEventExamples, privacyVerbs } from "./plans.mjs";
import { agentManifestValid, agentScope, agentGatewayBinding } from "./agents.mjs";
import { policyBinding, activeBundleValid } from "./policy.mjs";
import { complianceClaims, controlMapped } from "./compliance.mjs";

/** Alle checks køres i denne rækkefølge; rækkefølgen er også rapportrækkefølgen. */
export const CHECKS = [
  schemaValid,
  verbsDeclared,
  verbHonesty,
  identityNoLocalStore,
  telemetryEnvelope,
  evidenceResolvable,
  cloudEventExamples,
  privacyVerbs,
  policyBinding,
  activeBundleValid,
  complianceClaims,
  controlMapped,
  agentManifestValid,
  agentScope,
  agentGatewayBinding,
];
