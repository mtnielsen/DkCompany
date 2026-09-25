/**
 * DKC-023 — fælles adapter-SDK.
 *
 * Hver ny adapter skal arve de samme kontroller i stedet for at genopfinde dem.
 * Denne fabrik samler de syv ting en adapter ellers implementerer hver for sig:
 *
 *   1. auth        — verificerbar identitet (mTLS-SVID eller betroet proxy)
 *   2. tenant      — tenant udledes af den verificerede principal, aldrig af
 *                    et klientfelt; fremmed tenant afvises
 *   3. PDP         — fail-closed beslutning; utilgængelig governance = nej
 *   4. audit       — hvert verbum efterlader et revisionsspor og en CloudEvent
 *   5. idempotency — en gated handling med idempotency-key udføres højst én gang
 *   6. health      — sundhed inkl. upstream-version og forhandling
 *   7. privacy     — de fem privacy-verber med ærlig partial/unsupported
 *
 * Dertil versionsforhandling (`negotiate()`), så en adapter ikke stiltiende
 * antager at en ny upstream-version eller edition virker.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { collectTenantClaims, resolveTenantContext } from "../../identity/src/tenant.mjs";
import { negotiateUpstreamVersion } from "./version.mjs";
import { classifyUpstreamError, httpStatusForError, GovernanceUnavailableError, IdempotencyConflictError, TenantRejectedError } from "./errors.mjs";

export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

/** Læs og afgræns en JSON-body. Kaster en fejl med status 400 ved ugyldig input. */
export function readJsonBody(req, { maxBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        const err = new Error("body for stor");
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        const e = new Error(`ugyldig JSON: ${err.message}`);
        e.status = 400;
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function authContext(req) {
  let peerCertificate = null;
  try {
    const cert = req.socket?.getPeerCertificate?.();
    if (cert && Object.keys(cert).length > 0) peerCertificate = cert;
  } catch {
    peerCertificate = null;
  }
  return { peerCertificate, remoteAddress: req.socket?.remoteAddress ?? null };
}

function defaultEventPrefix(serviceName) {
  return `dk.platform.${serviceName}.`;
}

/**
 * @param {object} config
 * @param {string} config.serviceName
 * @param {object|Function} config.authenticate
 * @param {object} config.pdp                        Objekt med `decide(input)`.
 * @param {object} [config.upstream]                 `{ name, version, edition, supportedRanges, supportedEditions, onUnsupported, ping }`
 * @param {object|null} [config.idempotency]         Store fra `idempotency.mjs`.
 */
export function createAdapterSdk({
  serviceName,
  version = "1.0.0",
  environment = "dev",
  source = null,
  eventTypePrefix = null,
  authenticate,
  pdp,
  upstream = null,
  onAudit = () => {},
  onEvent = () => {},
  idempotency = null,
  replayable = null,
  now = () => Date.now(),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  if (!serviceName) throw new Error("createAdapterSdk kræver serviceName");
  if (!authenticate) throw new Error("createAdapterSdk kræver authenticate");
  if (!pdp) throw new Error("createAdapterSdk kræver pdp");
  const authenticateFn = typeof authenticate === "function" ? authenticate : authenticate.authenticate.bind(authenticate);
  const eventPrefix = eventTypePrefix ?? defaultEventPrefix(serviceName);
  const dataSource = source ?? `urn:platform:module:${serviceName}`;
  const replayableFor = typeof replayable === "function" ? replayable : (verb) => !verb.startsWith("subject.");

  function respond(res, code, body, headers = {}) {
    res.writeHead(code, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  function audit(entry) {
    onAudit({ ...entry, service: serviceName, at: new Date(now()).toISOString() });
  }

  function emit(verb, principal, tenantId, decision, dataCategory) {
    const event = {
      specversion: "1.0",
      id: randomUUID(),
      source: dataSource,
      type: `${eventPrefix}${verb.replace(/\./g, "-")}.completed`,
      time: new Date(now()).toISOString(),
      datacontenttype: "application/json",
      tenantid: tenantId,
      traceid: randomBytes(16).toString("hex"),
      spanid: randomBytes(8).toString("hex"),
      principal,
      dataclassification: dataCategory,
      data: { verb, decision },
    };
    onEvent(event);
    audit({ type: `${verb}.completed`, verb, principal, tenantId, payload: { decision } });
    return event;
  }

  function negotiationFor(upstreamVersion = null, edition = null) {
    if (!upstream) return null;
    const version = upstreamVersion ?? upstream.version ?? null;
    const ranges = upstream.supportedRanges ?? [];
    if (!version && ranges.length === 0) return null;
    return negotiateUpstreamVersion({
      upstreamVersion: version,
      edition: edition ?? upstream.edition ?? null,
      supportedRanges: ranges,
      supportedEditions: upstream.supportedEditions ?? [],
      onUnsupported: upstream.onUnsupported ?? "refuse",
    });
  }

  /**
   * Den fulde, gated verbumskæde. Returnerer et promise så HTTP-serveren kan
   * videresende den direkte.
   */
  async function guard(req, res, verb, handler, options = {}) {
    // 1) Verificerbar identitet.
    let principal;
    try {
      principal = await authenticateFn(req.headers.authorization, req.headers, authContext(req));
    } catch (err) {
      return respond(res, 401, { error: err.message, code: err.code ?? "unauthenticated" });
    }

    // 2) Body.
    let body = {};
    if (req.method !== "GET") {
      try {
        body = await readJsonBody(req, { maxBytes: maxBodyBytes });
      } catch (err) {
        return respond(res, err.status ?? 400, { error: err.message });
      }
    }

    // 3) Tenant udledes af den verificerede principal.
    let tenantContext;
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      tenantContext = resolveTenantContext({
        principal,
        claimed: collectTenantClaims({ headers: req.headers, body, query: Object.fromEntries(url.searchParams) }),
        resourceIds: body.resourceIds ?? options.resourceIds ?? [],
        source: options.tenantSource ?? "request",
      });
    } catch (err) {
      audit({ type: "tenant.rejected", verb, principal, tenantId: principal?.tenantId ?? null, payload: { code: err.code, reason: err.message } });
      return respond(res, err.status ?? 403, { error: err.message, code: err.code ?? "tenant_rejected" });
    }
    const tenantId = tenantContext.tenantId;

    // 3b) Versionsforhandling. Et verbum mod en ikke-understøttet upstream-
    //     version afvises, før PDP overhovedet spørges.
    if (upstream && options.checkVersion !== false) {
      const negotiation = negotiationFor(body.upstreamVersion ?? options.upstreamVersion, body.upstreamEdition ?? options.upstreamEdition);
      if (negotiation && negotiation.status !== "supported") {
        audit({ type: "upstream.version_rejected", verb, principal, tenantId, payload: { negotiation } });
        return respond(res, 409, { error: negotiation.reason, code: "version_unsupported", negotiation });
      }
    }

    // 4) Idempotens: en gated handling med nøgle må højst udføres én gang.
    const idempotencyKey = body.idempotencyKey ?? req.headers["idempotency-key"] ?? options.idempotencyKey ?? null;
    const scope = `${serviceName}:${verb}`;
    let claimed = null;
    if (idempotency && idempotencyKey) {
      const claim = idempotency.claim({ tenantId, scope, idempotencyKey, request: { verb, body, target: body.target ?? serviceName } });
      claimed = { key: idempotencyKey, ...claim };
      if (claim.status === "conflict") {
        audit({ type: "idempotency.conflict", verb, principal, tenantId, payload: { idempotencyKey } });
        return respond(res, 409, { error: "idempotency-nøgle genbrugt med andet indhold", code: "idempotency_conflict" });
      }
      if (claim.status === "in-flight") {
        return respond(res, 409, { error: "idempotency-nøgle er allerede under behandling", code: "idempotency_in_progress" });
      }
      if (claim.status === "replay") {
        audit({ type: "idempotency.replay", verb, principal, tenantId, payload: { idempotencyKey } });
        const stored = claim.record?.response ?? null;
        return respond(res, 200, { verb, decision: stored?.decision ?? "allow", result: stored?.result ?? null, traceId: stored?.traceId ?? null, replayed: true });
      }
    }

    // 5) Fail-closed policybeslutning.
    const input = {
      principal: { kind: principal.kind, id: principal.id, ...(principal.spiffeId ? { spiffeId: principal.spiffeId } : {}) },
      action: { verb, target: body.target ?? serviceName, environment: body.environment ?? environment },
      context: { tenantId, evidence: body.evidence ?? [] },
    };
    let decision;
    try {
      decision = await pdp.decide(input);
    } catch (err) {
      if (err instanceof GovernanceUnavailableError || err?.name === "GovernanceUnavailable") {
        audit({ type: "governance.unavailable", verb, principal, tenantId, payload: { reason: err.message } });
        if (idempotency && claimed) idempotency.fail({ tenantId, scope, idempotencyKey, error: "governance unavailable" });
        return respond(res, 503, { error: "governance unavailable", failMode: "closed", detail: err.message });
      }
      throw err;
    }
    if (decision.decision === "deny") {
      audit({ type: "policy.denied", verb, principal, tenantId, payload: { decision } });
      if (idempotency && claimed) idempotency.fail({ tenantId, scope, idempotencyKey, error: "denied" });
      return respond(res, 403, { error: "denied", decision });
    }
    if (decision.decision === "allow-with-approval") {
      const approvals = Array.isArray(body.approvals) ? body.approvals : [];
      if (approvals.length < decision.requiredApprovals) {
        return respond(res, 428, { error: "approval required", requiredApprovals: decision.requiredApprovals });
      }
    }
    const missingEvidence = (decision.requiredEvidence ?? []).filter((e) => e !== "policy-allow" && !(body.evidence ?? []).includes(e));
    if (missingEvidence.length) return respond(res, 428, { error: "missing evidence", missingEvidence });

    // 6) Udfør og auditér.
    try {
      const result = await handler({ body, principal, tenantId, decision });
      const event = emit(verb, { kind: principal.kind, id: principal.id }, tenantId, decision.decision, verb.startsWith("subject.") ? "personal" : "operational");
      const payload = { verb, decision: decision.decision, result, traceId: event.traceid };
      if (idempotency && claimed) idempotency.complete({ tenantId, scope, idempotencyKey, response: payload, replayable: replayableFor(verb) });
      return respond(res, 200, payload);
    } catch (err) {
      const mapped = classifyUpstreamError(err);
      const status = httpStatusForError(mapped);
      audit({ type: status === 429 ? "upstream.rate_limited" : "upstream.error", verb, principal, tenantId, payload: { status, reason: mapped.message } });
      if (idempotency && claimed) idempotency.fail({ tenantId, scope, idempotencyKey, error: mapped.message });
      const headers = mapped.retryAfterSeconds ? { "retry-after": String(mapped.retryAfterSeconds) } : {};
      return respond(res, status, { error: status === 429 ? "upstream rate limited" : "upstream error", code: mapped.code, detail: mapped.message }, headers);
    }
  }

  /**
   * Sundhed. Kalder upstreams ping (hvis nogen) og rapporterer den forhandlede
   * version. En ikke-understøttet version gør health `degraded`, ikke `ok`.
   */
  async function health() {
    const negotiation = negotiationFor();
    let upstreamStatus = "unknown";
    let detail = null;
    if (upstream?.ping) {
      try {
        await upstream.ping();
        upstreamStatus = "ok";
      } catch (err) {
        upstreamStatus = "unavailable";
        detail = err.message;
      }
    }
    const versionStatus = negotiation?.status ?? "supported";
    const status = upstreamStatus === "unavailable" ? "unavailable" : versionStatus === "supported" ? "ok" : "degraded";
    const code = status === "unavailable" ? 503 : status === "degraded" ? 503 : 200;
    return {
      code,
      body: {
        status,
        service: serviceName,
        version,
        upstream: upstream?.name ?? null,
        upstreamVersion: negotiation?.version ?? upstream?.version ?? null,
        upstreamStatus,
        negotiation,
        ...(detail ? { detail } : {}),
      },
    };
  }

  return {
    serviceName,
    version,
    environment,
    source: dataSource,
    respond,
    audit,
    emit,
    negotiate: negotiationFor,
    health,
    guard,
  };
}

export { TenantRejectedError, IdempotencyConflictError };
