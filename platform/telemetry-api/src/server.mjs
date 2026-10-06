/**
 * DKC-066 — HTTP-API for telemetri.
 *
 * Serveren eksponerer:
 *   - `POST /v1/ingest`         autentificeret indtagning (scope udledes server-side)
 *   - `GET  /v1/views/:view`    tenant-scopede dashboard-views
 *   - `GET  /v1/records`        paginerede, tenant-scopede råhændelser
 *   - `GET  /v1/resources/:id`  link-/ressourceopslag med tenant-spærring
 *   - `GET  /v1/adapters`       registrerede, read-only dashboard-adaptere
 *   - `GET  /v1/collectors`     collector-selvovervågning
 *   - `GET  /healthz`, `GET /metrics`
 *
 * Autentificering sker med et verificeret Ed25519-JWS (samme som DKC-010).
 * Principalen udledes af de signerede claims; et tenantpåstand i body påvirker
 * ikke scope. Serveren har ingen udførelsesruter.
 */
import { createServer } from "node:http";
import { verifyJws } from "../../credentials/src/jws.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { collectorStatus } from "./collectors.mjs";

const AUDIENCE = "telemetry-api";

/** Byg en autentificeringsfunktion ud fra et JWKS. */
export function createJwsAuthenticator({ jwks = [], clock = () => Date.now(), maxSkewSeconds = 5 } = {}) {
  const byKid = new Map();
  const entries = Array.isArray(jwks) ? jwks : (jwks?.keys ?? []);
  for (const entry of entries) {
    const jwk = entry?.jwk ?? entry;
    const kid = jwk?.kid ?? entry?.kid;
    if (kid) byKid.set(kid, jwk);
  }
  return {
    authenticate(req) {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) throw new AuthorizationError("manglende bearer-token", { status: 401, code: "unauthenticated" });
      const result = verifyJws({
        token,
        resolveKey: (kid) => byKid.get(kid) ?? null,
        clock,
        maxSkewSeconds,
      });
      if (!result.ok) throw new AuthorizationError(`token afvist: ${result.reasons.join("; ")}`, { status: 401, code: "unauthenticated" });
      const claims = result.claims;
      if (claims.aud && claims.aud !== AUDIENCE) throw new AuthorizationError(`tokenet er ikke udstedt til '${AUDIENCE}'`, { status: 401, code: "unauthenticated" });
      return {
        id: claims.sub,
        tenantId: claims.tenantId ?? claims.tenant_id ?? null,
        roles: claims.roles ?? [],
        viewScope: claims.viewScope ?? claims.view_scope ?? [],
        environment: claims.environment ?? claims.env ?? null,
        service: claims.service ?? null,
        kind: claims.kind ?? "service",
      };
    },
  };
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(payload);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("body overstiger grænsen"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createTelemetryServer({ ingestor, query, registry, authenticator, adapters = null, clock = () => Date.now(), maxEnvelopeBytes = 262144 } = {}) {
  if (!ingestor || !query || !authenticator) throw new Error("createTelemetryServer kræver ingestor, query og authenticator");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        send(res, 200, { status: "ok", ingest: ingestor.stats() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/metrics") {
        const stats = ingestor.stats();
        const lines = [
          `# HELP telemetry_ingested_total Accepterede telemetri-enveloper`,
          `# TYPE telemetry_ingested_total counter`,
          `telemetry_ingested_total ${stats.accepted}`,
          `telemetry_rejected_total ${stats.rejected}`,
          `telemetry_duplicate_total ${stats.duplicate}`,
          `telemetry_backpressure_total ${stats.backpressure}`,
          `telemetry_late_total ${stats.late}`,
          `telemetry_buffer_size ${stats.buffer}`,
        ];
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        res.end(lines.join("\n") + "\n");
        return;
      }

      const principal = authenticator.authenticate(req);

      if (req.method === "POST" && url.pathname === "/v1/ingest") {
        const raw = await readBody(req, maxEnvelopeBytes);
        let envelope;
        try {
          envelope = JSON.parse(raw);
        } catch (err) {
          send(res, 400, { accepted: false, status: "rejected", reason: `ugyldig JSON: ${err.message}` });
          return;
        }
        const result = ingestor.ingest({ principal, envelope, receivedAt: new Date(clock()).toISOString() });
        if (result.status === "backpressure") {
          send(res, 429, result, { "retry-after": String(result.retryAfterSeconds ?? 1) });
          return;
        }
        send(res, result.accepted ? 202 : 422, result);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/views/")) {
        const view = url.pathname.split("/")[3];
        const result = query.readView({
          principal,
          view,
          tenantId: url.searchParams.get("tenant"),
          environment: url.searchParams.get("environment"),
          service: url.searchParams.get("service"),
          params: {
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
            global: url.searchParams.get("global") === "true",
            windowSeconds: url.searchParams.get("windowSeconds") ? Number(url.searchParams.get("windowSeconds")) : undefined,
          },
          now: clock(),
        });
        send(res, 200, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/records") {
        const result = query.readRecords({
          principal,
          tenantId: url.searchParams.get("tenant"),
          signal: url.searchParams.get("signal"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 100,
          cursor: url.searchParams.get("cursor"),
        });
        send(res, 200, result);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/resources/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/resources/".length));
        const result = query.resolveLink({ principal, resourceId: id });
        send(res, 200, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/adapters") {
        send(res, 200, { adapters: adapters ? adapters.list() : [] });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/collectors") {
        send(res, 200, collectorStatus({ registry, observations: {}, now: clock() }));
        return;
      }

      send(res, 404, { error: "not found" });
    } catch (err) {
      const status = err.status ?? (err.name === "AuthorizationError" ? 403 : 500);
      send(res, status, { error: err.message, code: err.code ?? null });
    }
  });

  return {
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
