import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createTenantModelHistory } from "../../identity/src/tenant-store.mjs";
import { collectTenantClaims, resolveTenantContext } from "../../identity/src/tenant.mjs";

export class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

/**
 * AI-gateway. Alle modelkald går gennem denne tjeneste.
 *
 * - En agent kan kun nå en model gennem en route, der peger på agentens manifest.
 *   Manglende route = ingen modeladgang (403).
 * - Budgetter håndhæves pr. agent. Overskridelse = 429 med eskalering.
 * - Hvert kald logges med provider, model og modelversion, så beslutninger kan
 *   rekonstrueres (AI Act transparens).
 *
 * Leverandøren er injiceret. Runtimen har ingen leverandøradgang; kun gatewayen.
 *
 * DKC-006: modelhistorik og budget er tenant-bundet. Når en authenticator er
 * konfigureret, udledes tenanten af den verificerede principal; en
 * klientleveret tenant-header må kun stemme med den.
 */
export function createGateway({ routes, provider, clock = () => Date.now(), onCall = () => {}, authenticator = null, history = createTenantModelHistory() }) {
  const enabled = routes.filter((r) => r.enabled !== false);
  const usage = new Map();
  const authenticateFn = authenticator ? (typeof authenticator === "function" ? authenticator : authenticator.authenticate.bind(authenticator)) : null;

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

  function resolveRoute({ tenantId = null, agentRef, routeId, model }) {
    const forAgent = enabled.filter((r) => r.agentRef === agentRef && (r.tenantId == null || r.tenantId === tenantId));
    if (routeId) return forAgent.find((r) => r.id === routeId) ?? null;
    if (model) return forAgent.find((r) => r.model === model) ?? null;
    return forAgent[0] ?? null;
  }

  async function complete({ tenantId = null, agentRef, routeId, model, messages, maxTokens }) {
    if (!agentRef) throw new GatewayError("manglende agent-identitet", 401);
    const route = resolveRoute({ tenantId, agentRef, routeId, model });
    if (!route) throw new GatewayError(`ingen gateway-route for agent '${agentRef}' — direkte leverandørkald er forbudt`, 403);

    const used = usageFor(tenantId, agentRef);
    if (route.maxTokens != null && used.tokens >= route.maxTokens) throw new GatewayError("token-budget overskredet", 429);
    if (route.maxCostEur != null && used.costEur >= route.maxCostEur) throw new GatewayError("cost-budget overskredet", 429);

    let result;
    try {
      result = await provider.complete({ provider: route.provider, model: route.model, modelVersion: route.modelVersion, messages, maxTokens });
    } catch (err) {
      throw new GatewayError(`leverandørfejl: ${err.message}`, 502);
    }

    const tokens = result.tokens ?? 0;
    const costEur = result.costEur ?? 0;
    used.tokens += tokens;
    used.costEur += costEur;
    used.calls += 1;

    const call = {
      id: randomUUID(),
      at: new Date(clock()).toISOString(),
      tenantId: tenantId ?? null,
      agentRef,
      route: route.id,
      provider: route.provider,
      model: route.model,
      modelVersion: route.modelVersion,
      tokens,
      costEur,
    };
    if (tenantId) history.record({ ...call });
    onCall(call);

    return { id: call.id, text: result.text ?? "", tokens, costEur, provider: route.provider, model: route.model, modelVersion: route.modelVersion, route: route.id };
  }

  function respond(res, code, body) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
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
      return respond(res, 200, { agentRef, tenantId: requestedTenant, usage: usageFor(requestedTenant, agentRef) });
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
        try {
          const result = await complete({
            tenantId,
            agentRef: req.headers["x-agent-ref"],
            routeId: req.headers["x-route"],
            model: payload.model,
            messages: payload.messages ?? [],
            maxTokens: payload.max_tokens,
          });
          return respond(res, 200, {
            id: result.id,
            object: "chat.completion",
            created: Math.floor(clock() / 1000),
            model: result.model,
            modelVersion: result.modelVersion,
            provider: result.provider,
            route: result.route,
            choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
            usage: { total_tokens: result.tokens, cost_eur: result.costEur },
          });
        } catch (err) {
          if (err instanceof GatewayError) {
            return respond(res, err.status, { error: err.message, escalate: err.status === 429 });
          }
          return respond(res, 500, { error: err.message });
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
