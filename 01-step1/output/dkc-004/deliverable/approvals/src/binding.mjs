/**
 * DKC-004 — deterministisk binding mellem en godkendelse og den præcise ændring.
 *
 * En godkendelse er kun gyldig for den kombination af kunde (tenant), miljø,
 * verbum, mål, parameter-/diff-digest, policy-version og udløb, som godkenderen
 * faktisk så. Bindingen beregnes server-side; klienten kan hverken medsende
 * eller ændre den. Ændres ét af felterne, ændres digesten, og en tidligere
 * godkendelse holder ikke længere.
 */
import { createHash } from "node:crypto";

/**
 * Stabilt JSON (sorterede nøgler, rekursivt), så to semantisk ens payloads
 * giver samme digest uanset nøglerækkefølge.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * De felter en beslutning er bundet til. Returnerer en kanonisk struktur, der
 * kan hashes. `parameters` medtages som et selvstændigt digest, så store
 * parameterblokke ikke lækker mere end nødvendigt i selve bindingen.
 */
export function computeBinding(request) {
  const change = request?.change ?? {};
  const targets = [...(change.targets ?? [])].map(String).sort();
  return {
    tenantId: request?.tenantId ?? null,
    environment: change.environment ?? null,
    verb: change.verb ?? null,
    targets,
    diffSha256: change.diff?.sha256 ?? null,
    parametersDigest: createHash("sha256").update(stableStringify(change.parameters ?? null)).digest("hex"),
    policyBundleVersion: request?.evidence?.policyEvaluation?.bundleVersion ?? null,
    expiresAt: request?.decision?.expiresAt ?? null,
  };
}

/** SHA-256 over den kanoniske binding. Samme input giver altid samme digest. */
export function computeBindingDigest(request) {
  return createHash("sha256").update(stableStringify(computeBinding(request))).digest("hex");
}

/** Den serverstyrede binding, som den skrives ind i `decision.binding`. */
export function bindingRecord(request, { at = new Date().toISOString() } = {}) {
  return {
    algorithm: "sha256",
    digest: computeBindingDigest(request),
    computedAt: at,
    fields: computeBinding(request),
  };
}

/**
 * Sammenlign den lagrede binding med den aktuelle payload. Returnerer en liste
 * af menneskelæsbare afvigelser (tom = intakt).
 */
export function bindingDrift(request) {
  const stored = request?.decision?.binding;
  if (!stored) return ["anmodningen har ingen serverstyret binding"];
  const current = computeBindingDigest(request);
  if (stored.digest !== current) return [`bindingen er ændret siden godkendelsen (lagret ${stored.digest.slice(0, 12)}…, aktuel ${current.slice(0, 12)}…)`];
  return [];
}
