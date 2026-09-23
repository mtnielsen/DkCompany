import { digestOf } from "./crypto.mjs";

/** Slå en feltsti op, fx "context.blastRadius.personalDataRecords". */
function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * Betingelses-DSL. Deterministisk og sideeffektfri:
 *   {all:[...]} {any:[...]} {not:{...}}
 *   {field, eq|neq|in|nin|matches|gte|lte|exists|containsAll|containsAny}
 *
 * Semantik for manglende felter: `in` er false, `nin` er true, alt andet er false.
 */
export function matchesCondition(input, condition) {
  if (!condition || typeof condition !== "object") throw new Error(`ugyldig betingelse: ${JSON.stringify(condition)}`);
  if (Array.isArray(condition.all)) return condition.all.every((c) => matchesCondition(input, c));
  if (Array.isArray(condition.any)) return condition.any.some((c) => matchesCondition(input, c));
  if (condition.not) return !matchesCondition(input, condition.not);
  if (typeof condition.field !== "string") throw new Error(`betingelse mangler 'field': ${JSON.stringify(condition)}`);

  const value = getPath(input, condition.field);
  if ("exists" in condition) return condition.exists ? value !== undefined : value === undefined;
  if ("eq" in condition) return value === condition.eq;
  if ("neq" in condition) return value !== condition.neq;
  if ("in" in condition) return value !== undefined && condition.in.includes(value);
  if ("nin" in condition) return !condition.nin.includes(value);
  if ("matches" in condition) return typeof value === "string" && new RegExp(condition.matches).test(value);
  if ("gte" in condition) return typeof value === "number" && value >= condition.gte;
  if ("lte" in condition) return typeof value === "number" && value <= condition.lte;
  if ("containsAll" in condition) return Array.isArray(value) && condition.containsAll.every((v) => value.includes(v));
  if ("containsAny" in condition) return Array.isArray(value) && condition.containsAny.some((v) => value.includes(v));
  throw new Error(`ukendt betingelsesoperator i: ${JSON.stringify(condition)}`);
}

/**
 * Evaluer et input mod en bundle. Højeste prioritet vinder; ved lige prioritet
 * afgør regel-id alfabetisk, så resultatet er deterministisk.
 */
export function evaluate(input, bundle, { pdpName = "platform-pdp", pdpVersion = "1.0.0" } = {}) {
  const rules = [...bundle.policies].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id)
  );
  const matched = rules.filter((rule) => matchesCondition(input, rule.when));
  const winner = matched[0] ?? null;

  const decision = winner ? winner.effect : bundle.default;
  const result = {
    decision,
    pdp: {
      name: pdpName,
      version: pdpVersion,
      bundleName: bundle.metadata.name,
      bundleVersion: bundle.metadata.version,
      bundleSha256: digestOf(bundle),
    },
    matchedRules: matched.map((r) => r.id),
    reasons: winner?.reason ? [winner.reason] : ["Ingen regel matchede; default er deny (fail-closed)."],
    evaluatedAt: new Date().toISOString(),
    inputSha256: digestOf(input),
  };

  if (winner?.requiredApprovals) result.requiredApprovals = winner.requiredApprovals;
  if (winner?.requiredEvidence) result.requiredEvidence = winner.requiredEvidence;
  if (winner?.obligations) result.obligations = winner.obligations.map((type) => ({ type }));

  return result;
}
