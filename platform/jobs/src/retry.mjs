/**
 * DKC-013 — begrænsede forsøg og dead-letter-beslutning.
 *
 * Et forsøg må kun gentages når alle tre gælder:
 *   1. handlingen er ikke irreversibel (en irreversibel skrivning gentages
 *      aldrig blindt),
 *   2. der er forsøg tilbage, og
 *   3. fejlen er forbigående.
 *
 * Ellers flyttes jobbet til dead-letter-køen, hvor et menneske kan inspicere
 * og genindlæse det. Backoff er eksponentiel med begrænset ventetid.
 */
export const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitter: 0.2,
};

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /temporar/i,
  /midlertidigt/i,
  /rate limit/i,
  /too many requests/i,
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /service unavailable/i,
  /governance utilgængelig/i,
];

/** Er fejlen forbigående og dermed sikker at forsøge igen? */
export function isRetryableError(error) {
  if (error == null) return false;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return TRANSIENT_PATTERNS.some((re) => re.test(text));
}

/** Eksponentiel backoff med jitter, begrænset af `maxDelayMs`. */
export function nextBackoffMs(attempt, policy = DEFAULT_RETRY_POLICY, random = Math.random) {
  const base = policy.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs;
  const max = policy.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs;
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = raw * (policy.jitter ?? 0);
  return Math.round(raw - jitter + random() * 2 * jitter);
}

/**
 * Beslut hvad der skal ske efter et forsøg.
 *
 * @param {object} args
 * @param {string} args.classification  read | reversible-write | irreversible-write
 * @param {string} args.state           den observerede tilstand (completed/failed/unknown/…)
 * @param {number} args.attempt         forsøgsnummer (1-baseret)
 * @param {number} args.maxAttempts
 * @param {boolean} args.retryable      er fejlen forbigående?
 * @returns {{action: "complete"|"retry"|"dead-letter"|"escalate", delayMs?: number, reason: string}}
 */
export function decideOutcome({ classification, state, attempt, maxAttempts = DEFAULT_RETRY_POLICY.maxAttempts, retryable = false, error = null } = {}) {
  if (state === "completed") return { action: "complete", reason: "jobbet er gennemført" };

  // Et irreversibelt udfald må aldrig gentages blindt.
  if (classification === "irreversible-write") {
    if (state === "unknown") return { action: "escalate", reason: "irreversibelt unknown outcome — kræver reconciliation, ikke blind retry" };
    return { action: "escalate", reason: `irreversibel skrivning fejlede (${state}) — eskaleres i stedet for at gentages` };
  }

  if (state === "unknown") {
    // Reversible/læsende: afvent reconciliation; hvis den ikke kan afgøres,
    // kan jobbet forsøges igen inden for grænsen.
  }

  if (attempt >= maxAttempts) {
    return { action: "dead-letter", reason: `maks. ${maxAttempts} forsøg nået (${error ? String(error) : state})` };
  }
  if (!retryable && state !== "unknown") {
    return { action: "dead-letter", reason: `ikke-forbigående fejl: ${error ? String(error) : state}` };
  }
  return { action: "retry", delayMs: nextBackoffMs(attempt), reason: `forsøg ${attempt}/${maxAttempts} fejlede forbigående` };
}
