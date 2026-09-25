/**
 * DKC-054 — diagnostik uden hemmeligheder.
 *
 * En supportbundle eller et preview må aldrig indeholde hemmeligheder. Alle
 * kendte følsomme feltnavne redigeres, og indholdet scannes for signaturer på
 * nøgler/tokens før bundlen overhovedet skrives. Et fund blokerer, det skjules
 * ikke.
 */
const SECRET_KEY_PATTERN = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential|authorization|signature|bearer)/i;
export const REDACTED = "[REDACTED]";

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

/** Redigér følsomme felter rekursivt. Returnerer en ny struktur. */
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecrets(child);
    }
    return out;
  }
  return value;
}

/** Find signaturer på hemmeligheder i en tekst/struktur. */
export function scanForSecrets(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  const findings = [];
  for (const pattern of SECRET_VALUE_PATTERNS) {
    const match = text.match(pattern);
    if (match) findings.push(match[0].slice(0, 12) + "…");
  }
  return findings;
}

/**
 * Byg et diagnosticeringsbevis. Hemmeligheder redigeres; hvis råmaterialet
 * indeholder en hemmelighedssignatur, fejler bygget (fail-closed).
 */
export function buildDiagnostics({ artifactRef, payload = {} } = {}) {
  const findings = scanForSecrets(payload);
  if (findings.length) {
    const error = new Error(`diagnostikken indeholder hemmelighedssignaturer: ${findings.join(", ")}`);
    error.code = "SECRET_LEAK";
    throw error;
  }
  return {
    redacted: true,
    secretScan: "pass",
    artifactRef,
    content: redactSecrets(payload),
  };
}
