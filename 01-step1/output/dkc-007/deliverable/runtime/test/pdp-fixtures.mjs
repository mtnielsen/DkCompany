/**
 * DKC-007 — velformede PDP-svar til test.
 *
 * Runtimen afviser nu tomme eller ubundne PDP-svar, så teststubberne skal
 * returnere et svar, der er bundet til det input, de faktisk modtager
 * (`inputSha256`). Det er den binding, testene efterprøver.
 */
import { digestOf } from "../src/digest.mjs";

export function validDecision(input, overrides = {}) {
  const merged = {
    decision: "allow",
    pdp: { name: "test-pdp", version: "1.0.0", bundleName: "platform", bundleVersion: "1.0.0" },
    matchedRules: ["test.allow"],
    reasons: [],
    evaluatedAt: "2025-09-02T00:00:00Z",
    inputSha256: digestOf(input),
    ...overrides,
  };
  if (merged.decision === "deny" && (!merged.reasons || merged.reasons.length === 0)) merged.reasons = ["afvist af test-pdp"];
  if (merged.decision === "allow-with-approval" && merged.requiredApprovals === undefined) merged.requiredApprovals = 1;
  return merged;
}

export function validPdp(overrides = {}) {
  return { decide: async (input) => validDecision(input, overrides) };
}
