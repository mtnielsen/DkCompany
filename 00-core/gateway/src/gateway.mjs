import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

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
 */
export function createGateway({ routes, provider, clock = () => Date.now(), onCall = () => {} }) {
  const enabled = routes.filter((r) => r.enabled !== false);
  const usage = new Map();

  function usageFor(agentRef) {
    if (!usage.has(agentRef)) usage.set(agentRef, { tokens: 0, costEur: 0, calls: 0 });
    return usage.get(agentRef);
  }

  function resolveRoute({ agentRef, routeId, model }) {
    const forAgent = enabled.filter((r) => r.agentRef === agentRef);
    if (routeId) return forAgent.find((r) => r.id === routeId) ?? null;
    if (model) return forAgent.find((r) => r.model === model) ?? null;
    return forAgent[0] ?? null;
  }

  async function complete({ agentRef, routeId, model, messages, maxTokens }) {
    if (!agentRef) throw new GatewayError("manglende agent-identitet", 401);
    const route = resolveRoute({ agentRef, routeId, model });
    if (!route) throw new GatewayError(`ingen gateway-route for agent '${agentRef}' — direkte leverandørkald er forbudt`, 403);

    const used = usageFor(agentRef);
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
      agentRef,
      route: route.id,
      provider: route.provider,
      model: route.model,
      modelVersion: route.modelVersion,
      tokens,
      costEur,
    };
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
      const agentRef = new URL(req.url, "http://localhost").searchParams.get("agentRef");
      if (!agentRef) return respond(res, 400, { error: "agentRef mangler" });
      return respond(res, 200, { agentRef, usage: usageFor(agentRef) });
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
        try {
          const result = await complete({
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
