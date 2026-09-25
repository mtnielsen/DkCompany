/**
 * DKC-023 — fejltaksonomi for adaptere.
 *
 * En adapter må ikke svare "noget gik galt" på alt. Klienten skal kunne se
 * forskel på:
 *   - at governance (PDP) er utilgængelig → fail-closed, ingen handling
 *   - at en identitet/tenant afvises → 401/403
 *   - at upstream svarer med en fejl → mappet, ikke skjult
 *   - at upstream rate-limiter → 429 med Retry-After
 *   - at upstream-versionen ikke er understøttet → afvisning, ikke stille
 *     nedgradering
 *
 * Klassifikationen er ren og kan kaldes fra konformance, tests og SDK'en.
 */

export class AdapterError extends Error {
  constructor(message, { code = "adapter_error", status = 500, cause } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

export class GovernanceUnavailableError extends AdapterError {
  constructor(message, options = {}) {
    super(message, { code: "governance_unavailable", status: 503, ...options });
  }
}

export class TenantRejectedError extends AdapterError {
  constructor(message, { code = "tenant_mismatch", status = 403 } = {}) {
    super(message, { code, status });
  }
}

export class UpstreamError extends AdapterError {
  constructor(message, { upstreamStatus = 502, retryAfterSeconds = null, body = null, cause } = {}) {
    super(message, { code: "upstream_error", status: 502, cause });
    this.upstreamStatus = upstreamStatus;
    this.retryAfterSeconds = retryAfterSeconds;
    this.body = body;
  }
}

export class UpstreamRateLimitedError extends UpstreamError {
  constructor(message, { retryAfterSeconds = 60, body = null, cause } = {}) {
    super(message, { upstreamStatus: 429, retryAfterSeconds, body, cause });
    this.name = "UpstreamRateLimitedError";
    this.code = "upstream_rate_limited";
  }
}

export class VersionUnsupportedError extends AdapterError {
  constructor(message, { upstreamVersion = null, supportedRanges = [], edition = null } = {}) {
    super(message, { code: "version_unsupported", status: 409 });
    this.upstreamVersion = upstreamVersion;
    this.supportedRanges = supportedRanges;
    this.edition = edition;
  }
}

export class IdempotencyConflictError extends AdapterError {
  constructor(message, { idempotencyKey = null } = {}) {
    super(message, { code: "idempotency_conflict", status: 409 });
    this.idempotencyKey = idempotencyKey;
  }
}

export class CapabilityUnsupportedError extends AdapterError {
  constructor(message, { verb = null, declared = "unsupported" } = {}) {
    super(message, { code: "capability_unsupported", status: 501 });
    this.verb = verb;
    this.declared = declared;
  }
}

const RATE_LIMIT_RE = /rate.?limit|too many requests|429/i;

/**
 * Klassificér en fejl fra en upstream-klient. Klienten bør selv kaste
 * `UpstreamError`; denne funktion fanger ældre/generiske fejl og giver dem en
 * korrekt HTTP-betydning i stedet for altid at svare 502.
 */
export function classifyUpstreamError(err) {
  if (err instanceof UpstreamError) return err;
  // En adapterfejl fra adapteren selv (fx en naegtet deling eller en blokeret
  // sletning) er allerede klassificeret og skal bevare sin status/kode i
  // stedet for at blive pakket ind som en generisk upstream-fejl (502).
  if (err instanceof AdapterError) return err;
  const status = err?.status ?? err?.statusCode ?? err?.response?.status ?? null;
  const retryAfter = err?.retryAfterSeconds ?? err?.retryAfter ?? null;
  if (status === 429 || (status === null && RATE_LIMIT_RE.test(err?.message ?? ""))) {
    return new UpstreamRateLimitedError(err?.message ?? "upstream rate limited", {
      retryAfterSeconds: Number(retryAfter) || 60,
      cause: err,
    });
  }
  return new UpstreamError(err?.message ?? "upstream error", { upstreamStatus: status ?? 502, cause: err });
}

/** Den HTTP-status en adapter skal svare med for en given fejl. */
export function httpStatusForError(err) {
  if (err instanceof UpstreamRateLimitedError) return 429;
  if (err instanceof UpstreamError) return 502;
  if (err instanceof AdapterError) return err.status;
  return 502;
}
