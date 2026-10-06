import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { createTenantModelHistory } from "../../identity/src/tenant-store.mjs";
import { collectTenantClaims, resolveTenantContext } from "../../identity/src/tenant.mjs";
import { resolveRoute, effectiveMaxOutput, RoutingError } from "./routing.mjs";
import { createGatewayAccounting } from "./accounting.mjs";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class GatewayError extends Error {
  constructor(message, status, code = null, extra = {}) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * AI-gateway. Alle modelkald går gennem denne tjeneste.
 *
 * - En agent kan kun nå en model gennem en serverstyret route, der peger på
 *   agentens manifest og tillader den angivne dataklasse. Manglende route =
 *   ingen modeladgang (403).
 * - Klienten kan ikke vælge leverandør og ikke hæve route'ens budget eller
 *   max-output.
 * - Budgettet reserveres atomisk før kaldet og afregnes bagefter. To samtidige
 *   kald kan ikke bruge den samme resterende budgetpost.
 * - Hvert kald logges med provider, model, modelversion og dataklasse — men
 *   aldrig med rå samtaleindhold.
 *
 * Leverandøren er injiceret. Runtimen har ingen leverandøradgang; kun
 * gatewayen har en egress-vagt.
 *
 * DKC-006: modelhistorik og budget er tenant-bundet. DKC-012: routing,
 * dataklasser, bindende budget og idempotens.
 */
export function createGateway({ routes, provider, clock = () => Date.now(), onCall = () => {}, authenticator = null, history = createTenantModelHistory(), budgetStore = null, callStore = null }) {
  const enabled = routes.filter((r) => r.enabled !== false);
  const usage = new Map();
  const authenticateFn = authenticator ? (typeof authenticator === "function" ? authenticator : authenticator.authenticate.bind(authenticator)) : null;
  const accounting = budgetStore || callStore ? createGatewayAccounting({ budgetStore, callStore, clock }) : null;
  const accountingEnabled = Boolean(budgetStore);

  async function authenticateRequest(req) {
    if (!authenticateFn) throw new GatewayError("identitetsverificering er ikke konfigureret", 503);
    let peerCertificate = null;
    try {
      const cert = req.socket?.getPeerCertificate?.();
      if (cert && Object.keys(cert).length > 0) peerCertificate = cert;
    } catch {
      peerCertificate = null;
    }
    return authenticateFn(req.headers.authorization, req.headers, { peerCertificate, remoteAddress: req.socket?.remoteAddress ?? null });
  }

  // Uden tenant bevarer vi den gamle nøgle (agentRef), så eksisterende
  // integrationer ikke ændrer adfærd; med tenant namespaces budgettet.
  const usageKey = (tenantId, agentRef) => (tenantId ? `${tenantId}\u0000${agentRef}` : agentRef);

  function usageFor(tenantId, agentRef) {
    const key = usageKey(tenantId, agentRef);
    if (!usage.has(key)) usage.set(key, { tokens: 0, costEur: 0, calls: 0 });
    return usage.get(key);
  }

  function logRecord({ call, resolved, requestDigest }) {
    // Rå samtaleindhold logges aldrig. Persondataklasser logges kun som
    // metadata + digest, så loggen ikke bliver et personregister.
    return {
      id: call.id,
      at: call.at,
      tenantId: call.tenantId ?? null,
      agentRef: call.agentRef,
      route: call.route,
      provider: call.provider,
      model: call.model,
      modelVersion: call.modelVersion,
      dataClass: resolved?.dataClass ?? "internal",
      personalData: Boolean(resolved?.personalData),
      requestDigest,
      promptLogged: false,
      tokens: call.tokens,
      costEur: call.costEur,
    };
  }

  async function complete({ tenantId = null, agentRef, routeId, model, provider: requestedProvider = null, messages = [], maxTokens, dataClass, idempotencyKey = null, onToken, signal, stream = false } = {}) {
    if (!agentRef) throw new GatewayError("manglende agent-identitet", 401);
    let resolved;
    try {
      resolved = resolveRoute({ routes: enabled, tenantId, agentRef, dataClass, routeId, model, provider: requestedProvider });
    } catch (err) {
      if (err instanceof RoutingError) throw new GatewayError(err.message, err.status, err.code);
      throw err;
    }

    let effectiveMax;
    try {
      effectiveMax = effectiveMaxOutput({ resolved, requestedMaxTokens: maxTokens });
    } catch (err) {
      if (err instanceof RoutingError) throw new GatewayError(err.message, err.status, err.code);
      throw err;
    }

    const key = idempotencyKey ?? sha256({ tenantId, agentRef, route: resolved.route.id, messages, maxTokens: effectiveMax ?? null, dataClass: resolved.dataClass });
    let reservationId = null;

    if (accountingEnabled) {
      const begin = accounting.begin({ tenantId, agentRef, resolved, messages, maxOutputTokens: effectiveMax, idempotencyKey: key });
      if (begin.status === "replay") {
        const record = begin.record;
        const cached = record.response ?? { text: "", tokens: record.tokens, costEur: record.costEur, provider: record.provider, model: record.model, modelVersion: record.modelVersion, route: record.routeId };
        onCall(logRecord({ call: { id: randomUUID(), at: new Date(clock()).toISOString(), tenantId, agentRef, route: record.routeId, provider: record.provider, model: record.model, modelVersion: record.modelVersion, tokens: record.tokens, costEur: record.costEur }, resolved, requestDigest: record.requestDigest }));
        return { id: randomUUID(), ...cached, idempotentReplay: true };
      }
      if (begin.status === "conflict") throw new GatewayError("idempotency-key genbrugt med et andet indhold", 409, "idempotency_conflict");
      if (begin.status === "in-flight") throw new GatewayError("et identisk kald er allerede i gang", 409, "idempotency_in_flight");
      if (begin.status === "exceeded") throw new GatewayError("budget overskredet", 429, "budget_exceeded", { escalate: true });
      reservationId = begin.reservationId;
    } else {
      const used = usageFor(tenantId, agentRef);
      if (resolved.route.maxTokens != null && used.tokens >= resolved.route.maxTokens) throw new GatewayError("token-budget overskredet", 429, "budget_exceeded", { escalate: true });
      if (resolved.route.maxCostEur != null && used.costEur >= resolved.route.maxCostEur) throw new GatewayError("cost-budget overskredet", 429, "budget_exceeded", { escalate: true });
    }

    let result;
    try {
      result = await provider.complete({
        provider: resolved.route.provider,
        model: resolved.route.model,
        modelVersion: resolved.route.modelVersion,
        messages,
        maxTokens: effectiveMax,
        timeoutMs: resolved.timeoutMs,
        signal,
        onToken,
        stream: Boolean(stream),
        dataClass: resolved.dataClass,
      });
    } catch (err) {
      const partial = err.partial ?? null;
      if (accountingEnabled) {
        if (partial && (partial.tokens > 0 || partial.costEur > 0)) {
          // Afbrydelse med delvist forbrug: afregn det modtagne, men frigiv
          // idempotency-kravet, så et retry kan gennemføres.
          accounting.interrupt({ tenantId, idempotencyKey: key, reservationId, tokens: partial.tokens ?? 0, costEur: partial.costEur ?? 0 });
        } else {
          accounting.release({ tenantId, idempotencyKey: key, reservationId });
        }
      }
      if (err.name === "ProviderTimeoutError") throw new GatewayError(`leverandør-timeout: ${err.message}`, 504, "provider_timeout");
      if (err.name === "ProviderCancelledError") throw new GatewayError("leverandørkaldet blev afbrudt", 499, "provider_cancelled");
      throw new GatewayError(`leverandørfejl: ${err.message}`, err.status === 429 ? 429 : 502, "provider_error");
    }

    const tokens = result.tokens ?? 0;
    const costEur = result.costEur ?? 0;
    const response = { text: result.text ?? "", tokens, costEur, provider: resolved.route.provider, model: resolved.route.model, modelVersion: resolved.route.modelVersion, route: resolved.route.id };
    const requestDigest = accounting ? accounting.requestDigest({ agentRef, route: resolved.route, model: resolved.route.model, maxTokens: effectiveMax, messages, dataClass: resolved.dataClass }) : sha256(messages);

    if (accountingEnabled) {
      accounting.settle({ tenantId, resolved, idempotencyKey: key, reservationId, tokens, costEur, response });
    }
    const used = usageFor(tenantId, agentRef);
    used.tokens += tokens;
    used.costEur += costEur;
    used.calls += 1;

    const call = {
      id: randomUUID(),
      at: new Date(clock()).toISOString(),
      tenantId: tenantId ?? null,
      agentRef,
      route: resolved.route.id,
      provider: resolved.route.provider,
      model: resolved.route.model,
      modelVersion: resolved.route.modelVersion,
      tokens,
      costEur,
    };
    if (tenantId) history.record({ ...call });
    onCall(logRecord({ call, resolved, requestDigest }));

    return { id: call.id, ...response, dataClass: resolved.dataClass };
  }

  function respond(res, code, body) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  /**
   * SSE-skriver der først sender headers når det første token (eller den
   * afsluttende besked) faktisk skal skrives. Dermed kan en streaming-request
   * der afvises (routing, budget, idempotens) stadig få et rigtigt JSON-svar
   * med den korrekte HTTP-status i stedet for `200`.
   */
  function createSseWriter(res) {
    let started = false;
    const start = () => {
      if (started) return;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      started = true;
    };
    return {
      started: () => started,
      token: (token) => {
        start();
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
      },
      finish: (result) => {
        start();
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: result.tokens, cost_eur: result.costEur } })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      },
      error: (err) => {
        start();
        res.write(`data: ${JSON.stringify({ error: err.message, code: err.code ?? null })}\n\n`);
        res.end();
      },
    };
  }

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      return respond(res, 200, { status: "ok", routes: enabled.length });
    }
    if (req.method === "GET" && req.url.startsWith("/v1/usage")) {
      const params = new URL(req.url, "http://localhost").searchParams;
      const agentRef = params.get("agentRef");
      if (!agentRef) return respond(res, 400, { error: "agentRef mangler" });
      const requestedTenant = params.get("tenant") ?? params.get("tenantId") ?? null;
      const durable = budgetStore && requestedTenant ? budgetStore.list(requestedTenant) : null;
      return respond(res, 200, { agentRef, tenantId: requestedTenant, usage: usageFor(requestedTenant, agentRef), ...(durable ? { budgets: durable } : {}) });
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch (err) {
          return respond(res, 400, { error: `ugyldig JSON: ${err.message}` });
        }
        let tenantId = null;
        if (authenticator) {
          try {
            const principal = await authenticateRequest(req);
            tenantId = resolveTenantContext({
              principal,
              claimed: collectTenantClaims({ headers: req.headers, body: payload }),
              source: "request",
            }).tenantId;
          } catch (err) {
            return respond(res, err.status ?? 403, { error: err.message, code: err.code });
          }
        }

        const wantsStream = payload.stream === true;
        const sse = wantsStream ? createSseWriter(res) : null;
        const abortController = new AbortController();
        const onClientClose = () => abortController.abort();
        req.on("close", onClientClose);

        try {
          const result = await complete({
            tenantId,
            agentRef: req.headers["x-agent-ref"],
            routeId: req.headers["x-route"],
            model: payload.model,
            provider: payload.provider,
            messages: payload.messages ?? [],
            maxTokens: payload.max_tokens,
            dataClass: payload.data_class ?? payload.dataClass ?? req.headers["x-data-class"],
            idempotencyKey: req.headers["idempotency-key"] ?? null,
            onToken: sse ? sse.token : undefined,
            signal: abortController.signal,
            stream: wantsStream,
          });
          if (wantsStream) {
            sse.finish(result);
            return;
          }
          return respond(res, 200, {
            id: result.id,
            object: "chat.completion",
            created: Math.floor(clock() / 1000),
            model: result.model,
            modelVersion: result.modelVersion,
            provider: result.provider,
            route: result.route,
            dataClass: result.dataClass,
            choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
            usage: { total_tokens: result.tokens, cost_eur: result.costEur },
            ...(result.idempotentReplay ? { idempotent_replay: true } : {}),
          });
        } catch (err) {
          if (sse && sse.started()) {
            sse.error(err);
            return;
          }
          if (err instanceof GatewayError) {
            return respond(res, err.status, { error: err.message, code: err.code ?? null, escalate: err.status === 429 });
          }
          return respond(res, 500, { error: err.message });
        } finally {
          req.removeListener("close", onClientClose);
        }
      });
      return;
    }
    respond(res, 404, { error: "not found" });
  });

  return {
    enabled,
    usage,
    history,
    accounting,
    usageFor: (tenantId, agentRef) => usageFor(tenantId, agentRef),
    complete,
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
