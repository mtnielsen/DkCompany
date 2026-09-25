import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createAuditLog, createSubjectStore, filterEventsByTenant } from "./store.mjs";
import { buildCloudEvent } from "./events.mjs";
import { GovernanceUnavailable } from "./pdp-client.mjs";
import { AuthError } from "./auth.mjs";
import { collectTenantClaims, resolveTenantContext } from "../../../../identity/src/tenant.mjs";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Læs begivenheder fra en log der enten er in-memory (`log.events` er et array)
 * eller holdbar (`log.events(tenantId)` er en funktion). Tenantfiltreringen sker
 * i begge tilfælde.
 */
function logEvents(log, tenantId = null) {
  if (!log) return [];
  const all = typeof log.events === "function" ? log.events(tenantId) : log.events ?? [];
  return tenantId === null ? all : filterEventsByTenant(all, tenantId);
}

/** Verbum pr. rute. `null` betyder: kræver identitet, men ikke en PDP-beslutning. */
const ROUTES = [
  { method: "GET", path: "/healthz", verb: null, auth: false },
  { method: "GET", path: "/v1/audit/events", verb: null, handler: (c) => ({ events: logEvents(c.log, c.tenantId) }) },
  { method: "POST", path: "/v1/ops/backup", verb: "backup", handler: () => ({ result: "pass", bytes: 1048576 }) },
  { method: "POST", path: "/v1/ops/restore", verb: "restore", handler: (c) => ({ result: "pass", restoredFrom: c.body.artifact ?? "latest", verified: true }) },
  { method: "POST", path: "/v1/ops/verify-restore", verb: "verify-restore", handler: () => ({ result: "pass", verified: true }) },
  { method: "POST", path: "/v1/ops/drain", verb: "drain", handler: () => ({ result: "pass", drained: true, activeConnections: 0 }) },
  { method: "POST", path: "/v1/ops/upgrade/dry-run", verb: "upgrade.dry-run", handler: () => ({ result: "pass", clean: true, changes: [] }) },
  { method: "POST", path: "/v1/ops/upgrade", verb: "upgrade", handler: (c) => ({ result: "pass", fromVersion: c.body.fromVersion ?? c.version, toVersion: c.body.toVersion ?? c.version }) },
  { method: "POST", path: "/v1/ops/migrate", verb: "migrate", handler: (c) => ({ result: "pass", toSchema: c.body.toSchema ?? "v2", applied: 0 }) },
  { method: "POST", path: "/v1/ops/rollback", verb: "rollback", handler: (c) => ({ result: "pass", rolledBackTo: c.body.toVersion ?? "previous" }) },
  { method: "POST", path: "/v1/ops/slo", verb: "slo", handler: () => ({ availability: 99.95, latencyP95Ms: 42, errorBudgetRemaining: 0.87 }) },
  { method: "POST", path: "/v1/privacy/locate", verb: "subject.locate", handler: (c) => {
    const matches = c.subjects.locate(c.tenantId, c.body.identifiers);
    return { count: matches.length, matches: matches.map((r) => ({ id: r.id, categories: r.dataCategories ?? [] })) };
  } },
  { method: "POST", path: "/v1/privacy/export", verb: "subject.export", handler: (c) => {
    const matches = c.subjects.locate(c.tenantId, c.body.identifiers);
    return { count: matches.length, records: matches, artifactRef: `s3://evidence/dsar/${c.tenantId}/export-${randomUUID()}.json` };
  } },
  { method: "POST", path: "/v1/privacy/erase", verb: "subject.erase", handler: (c) => {
    const erased = c.subjects.erase(c.tenantId, c.body.identifiers);
    return { recordsAffected: erased.length, tombstoned: true };
  } },
  { method: "POST", path: "/v1/privacy/legal-hold", verb: "subject.legal_hold", handler: () => ({ holdId: randomUUID(), active: true, blocksErase: true }) },
  { method: "GET", path: "/v1/privacy/retention", verb: "retention.policy", handler: () => ({ policy: "standard", retainDays: 365, basis: "bogfoeringsloven" }) },
];

function matchRoute(method, pathname) {
  return ROUTES.find((r) => r.method === method && r.path === pathname);
}

/** CloudEvent-envelopen kræver onBehalfOf som objekt; policy-input tillader en streng. */
function toEventPrincipal(p) {
  const out = { kind: p.kind, id: p.id };
  if (p.spiffeId) out.spiffeId = p.spiffeId;
  if (p.oidcSub) out.oidcSub = p.oidcSub;
  if (p.autonomyClass) out.autonomyClass = p.autonomyClass;
  if (p.onBehalfOf) out.onBehalfOf = typeof p.onBehalfOf === "string" ? { kind: "group", id: p.onBehalfOf } : p.onBehalfOf;
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body for stor"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error(`ugyldig JSON: ${err.message}`));
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

/**
 * Referencemodul A: evidens-/audit-service.
 *
 * Implementerer alle fire planer: identitet (OIDC/SPIFFE), telemetri
 * (CloudEvents med tenantid/traceid/principal), ops-verber og privacy-verber.
 * Hver privilegeret handling spørger PDP'en og stopper, hvis governance ikke
 * kan nås. Alt havner i en hash-kædet, append-only audit-log.
 */
export function createAuditService({
  authenticate,
  pdp,
  log = createAuditLog(),
  subjects = createSubjectStore(),
  journal = null,
  credentialVerifier = null,
  credentialAudience = "module:audit-service",
  source = "urn:platform:module:audit-service",
  serviceName = "audit-service",
  version = "1.0.0",
  environment = "dev",
  onEvent,
} = {}) {
  if (!authenticate) throw new Error("createAuditService kræver en authenticate-funktion");
  if (!pdp) throw new Error("createAuditService kræver en pdp-klient");
  const authenticateFn = typeof authenticate === "function" ? authenticate : authenticate.authenticate.bind(authenticate);
  const startedAt = Date.now();
  const emitted = [];

  function emit(event) {
    emitted.push(event);
    onEvent?.(event);
  }

  function respond(res, code, body) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  async function guarded(req, res, route) {
    const url = new URL(req.url, "http://localhost");
    let principal;
    try {
      principal = await authenticateFn(req.headers.authorization, req.headers, authContext(req));
    } catch (err) {
      const status = err instanceof AuthError ? err.status : 401;
      return respond(res, status, { error: err.message });
    }

    let body = {};
    if (route.method !== "GET") {
      try {
        body = await readBody(req);
      } catch (err) {
        return respond(res, 400, { error: err.message });
      }
    }

    // DKC-006: tenant udledes af den verificerede principal. En påstand i
    // header/body/ressource-ID må kun stemme med den; ellers afvises requesten.
    let tenantContext;
    try {
      tenantContext = resolveTenantContext({
        principal,
        claimed: collectTenantClaims({ headers: req.headers, body, query: Object.fromEntries(url.searchParams) }),
        resourceIds: body.resourceIds ?? [],
        source: "request",
      });
    } catch (err) {
      const principalForLog = { kind: principal.kind, id: principal.id };
      log.append({ type: "tenant.rejected", verb: route.verb, principal: principalForLog, tenantId: principal.tenantId ?? null, payload: { code: err.code, reason: err.message } });
      return respond(res, err.status ?? 403, { error: err.message, code: err.code });
    }
    const tenantId = tenantContext.tenantId;
    const input = {
      principal: {
        kind: principal.kind,
        id: principal.id,
        ...(principal.spiffeId ? { spiffeId: principal.spiffeId } : {}),
        ...(principal.autonomyClass ? { autonomyClass: principal.autonomyClass } : {}),
        ...(principal.onBehalfOf ? { onBehalfOf: principal.onBehalfOf } : {}),
      },
      action: {
        verb: route.verb,
        target: body.target ?? serviceName,
        environment: body.environment ?? environment,
        ...(principal.autonomyClass ? { autonomyClass: principal.autonomyClass } : {}),
      },
      context: {
        tenantId,
        evidence: body.evidence ?? [],
        ...(body.untrustedInput !== undefined ? { untrustedInput: body.untrustedInput } : {}),
        ...(body.changeUri ? { changeUri: body.changeUri } : {}),
        ...(body.blastRadius ? { blastRadius: body.blastRadius } : {}),
      },
    };

    // DKC-010: når tjenesten er konfigureret med en credential-verifier, skal
    // hver privilegeret handling medbringe et gyldigt, scope-bundet credential
    // for netop dette verbum/mål/kunde/miljø og denne tjenestes audience.
    // Afvisningen er fail-closed og sker før handleren.
    if (credentialVerifier) {
      const header = req.headers["x-platform-credential"];
      const token = (typeof header === "string" && header) || body.credential?.token || (typeof body.credential === "string" ? body.credential : null);
      const check = credentialVerifier.verify(token, {
        audience: credentialAudience,
        verb: route.verb,
        resource: input.action.target,
        tenantId,
        environment: input.action.environment,
      });
      if (!check.ok) {
        log.append({ type: "credential.rejected", verb: route.verb, principal: input.principal, tenantId, payload: { reasons: check.reasons } });
        return respond(res, 403, { error: "credential afvist", failMode: "closed", reasons: check.reasons });
      }
    }

    let decision;
    try {
      decision = await pdp.decide(input);
    } catch (err) {
      if (err instanceof GovernanceUnavailable) {
        // Dødemandsgreb: ingen governance, ingen handling.
        log.append({ type: "governance.unavailable", verb: route.verb, principal: input.principal, tenantId, payload: { reason: err.message } });
        return respond(res, 503, { error: "governance unavailable", failMode: "closed", detail: err.message });
      }
      throw err;
    }

    if (decision.decision === "deny") {
      const event = log.append({ type: "policy.denied", verb: route.verb, principal: input.principal, tenantId, payload: { decision } });
      return respond(res, 403, { error: "denied", decision, auditEventId: event.id });
    }

    if (decision.decision === "allow-with-approval") {
      const approvals = Array.isArray(body.approvals) ? body.approvals : [];
      if (approvals.length < decision.requiredApprovals) {
        log.append({ type: "approval.pending", verb: route.verb, principal: input.principal, tenantId, payload: { requiredApprovals: decision.requiredApprovals, provided: approvals.length } });
        return respond(res, 428, { error: "approval required", requiredApprovals: decision.requiredApprovals, provided: approvals.length, decision });
      }
    }

    const missingEvidence = (decision.requiredEvidence ?? []).filter(
      (e) => e !== "policy-allow" && !(body.evidence ?? []).includes(e)
    );
    if (missingEvidence.length) {
      log.append({ type: "evidence.missing", verb: route.verb, principal: input.principal, tenantId, payload: { missingEvidence } });
      return respond(res, 428, { error: "missing evidence", missingEvidence, decision });
    }

    const ctx = { body, principal, tenantId, decision, log, subjects, serviceName, version, uptimeMs: Date.now() - startedAt };

    // DKC-009: den holdbare intent skrives og committes før handleren (den
    // eksterne ændring) kaldes. Er journalen utilgængelig, udføres intet.
    const idempotencyId = req.headers["idempotency-key"] ?? body.idempotencyId ?? randomUUID();
    if (journal) {
      let receipt;
      try {
        receipt = await journal.begin({
          tenantId,
          idempotencyId,
          verb: route.verb,
          target: input.action.target,
          environment: input.action.environment,
          actor: principal.id,
          request: { evidence: body.evidence ?? [], changeUri: body.changeUri ?? null },
          dataCategories: route.verb.startsWith("subject.") ? ["personal"] : [],
        });
      } catch (err) {
        log.append({ type: "audit.unavailable", verb: route.verb, principal: input.principal, tenantId, payload: { reason: err.message } });
        return respond(res, 503, { error: "audit unavailable", failMode: "closed", status: "halted", detail: err.message, auditEventId: null });
      }
      if (!receipt?.ok) {
        if (receipt?.state === "succeeded" || receipt?.state === "failed") {
          return respond(res, 200, { verb: route.verb, decision: decision.decision, idempotentReplay: true, outcome: receipt.outcome ?? null, idempotencyId });
        }
        return respond(res, 503, { error: "audit intent unresolved", failMode: "closed", status: "unknown", idempotencyId });
      }
    }

    const result = route.handler ? route.handler(ctx) : { result: "pass" };

    // Outcome skrives bagefter. Kan den ikke blive holdbar, rapporteres der
    // ikke success.
    if (journal) {
      try {
        const completed = await journal.complete({ tenantId, idempotencyId, outcome: "succeeded", result });
        if (!completed?.ok) throw new Error("outcome blev ikke bekræftet");
      } catch (err) {
        return respond(res, 503, { error: "audit outcome unavailable", failMode: "closed", status: "unknown", idempotencyId, detail: err.message });
      }
    }

    const auditEvent = log.append({
      type: `${route.verb}.completed`,
      verb: route.verb,
      principal: input.principal,
      tenantId,
      payload: { decision: decision.decision, obligations: decision.obligations ?? [], result },
    });
    emit(
      buildCloudEvent({
        source,
        type: `dk.platform.audit-service.${route.verb.replace(/\./g, "-")}.completed`,
        principal: toEventPrincipal(input.principal),
        tenantId,
        dataCategory: route.verb.startsWith("subject.") ? "personal" : "operational",
        data: { verb: route.verb, decision: decision.decision, auditEventId: auditEvent.id },
      })
    );

    return respond(res, 200, { verb: route.verb, decision: decision.decision, result, auditEventId: auditEvent.id });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    // DKC-009: HTTP-endpoints for action-journalen. Kun den verificerede
    // identitet kan skrive/læse sine egne intents (tenant udledes af principalen).
    if (url.pathname === "/v1/audit/intents" || url.pathname.startsWith("/v1/audit/intents/")) {
      (async () => {
        try {
          const principal = await authenticateFn(req.headers.authorization, req.headers, authContext(req));
          if (!journal) return respond(res, 503, { error: "audit-journal ikke konfigureret", failMode: "closed" });
          const requested = url.searchParams.get("tenant") ?? url.searchParams.get("tenantId");
          const tenantContext = resolveTenantContext({ principal, claimed: requested ? [requested] : [], source: "audit-intent" });
          const tenantId = tenantContext.tenantId;
          if (req.method === "POST" && url.pathname === "/v1/audit/intents") {
            const body = await readBody(req);
            const receipt = await journal.begin({ tenantId, idempotencyId: body.idempotencyId, verb: body.verb, target: body.target, environment: body.environment ?? null, actor: principal.id, request: body.request ?? {}, dataCategories: body.dataCategories ?? [] });
            return respond(res, receipt?.ok ? 201 : 200, receipt ?? {});
          }
          const match = /^\/v1\/audit\/intents\/([^/]+)(\/outcome)?$/.exec(url.pathname);
          if (match) {
            const idempotencyId = decodeURIComponent(match[1]);
            if (match[2]) {
              const body = await readBody(req);
              const completed = await journal.complete({ tenantId, idempotencyId, outcome: body.outcome ?? "succeeded", result: body.result ?? null, error: body.error ?? null });
              return respond(res, 200, completed ?? {});
            }
            const found = journal.lookup({ tenantId, idempotencyId });
            return respond(res, found?.found ? 200 : 404, found ?? {});
          }
          return respond(res, 404, { error: "not found" });
        } catch (err) {
          return respond(res, err.status ?? (err instanceof AuthError ? err.status : 401), { error: err.message, code: err.code });
        }
      })();
      return;
    }

    const route = matchRoute(req.method, url.pathname);
    if (!route) return respond(res, 404, { error: "not found" });

    if (route.auth === false) {
      return respond(res, 200, { status: "ok", service: serviceName, version, uptimeMs: Date.now() - startedAt, auditEvents: logEvents(log).length });
    }
    if (route.verb === null) {
      // Identitet påkrævet, men ikke en policy-beslutning (fx audit-oplæsning).
      (async () => {
        try {
          const principal = await authenticateFn(req.headers.authorization, req.headers, authContext(req));
          // Audit-oplæsning er tenantafgrænset: kun principalens egen kundes
          // events returneres, medmindre en scopet platformrolle beder om en
          // anden kunde eksplicit.
          const requested = url.searchParams.get("tenant") ?? url.searchParams.get("tenantId");
          const tenantContext = resolveTenantContext({ principal, claimed: requested ? [requested] : [], source: "audit-query" });
          const result = route.handler?.({ body: {}, principal, tenantId: tenantContext.tenantId, log, subjects, serviceName, version, uptimeMs: Date.now() - startedAt });
          respond(res, 200, result ?? {});
        } catch (err) {
          respond(res, err.status ?? (err instanceof AuthError ? err.status : 401), { error: err.message, code: err.code });
        }
      })();
      return;
    }
    guarded(req, res, route).catch((err) => respond(res, 500, { error: err.message }));
  });

  return {
    server,
    log,
    subjects,
    emitted,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

export { ROUTES };
