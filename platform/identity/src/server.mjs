/**
 * DKC-003 — sikker HTTP-request-pipeline.
 *
 * Rækkefølge: rate limit → CSRF/origin → strip klient-identitetsheadere →
 * verificér identitet → læs body inden for grænsen. Serveren udleder subject
 * og roller fra den verificerede identitet alene.
 */
import { createServer } from "node:http";
import { AuthenticationError, AuthorizationError } from "./errors.mjs";
import { createPlatformAuthenticator, stripIdentityHeaders } from "./identity.mjs";
import { PayloadTooLargeError, RequestError, assertCsrf, assertSameOrigin, createRateLimiter, parseCookies, readBody } from "./session.mjs";

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

export function createSecureHandler({ authenticator, sessionSecret, rateLimiter = createRateLimiter(), maxBytes = 256 * 1024, allowedOrigins = [], handler }) {
  if (!authenticator) throw new Error("createSecureHandler kræver en authenticator");
  if (!handler) throw new Error("createSecureHandler kræver en handler");

  return async function handle(req, res) {
    const remoteAddress = req.socket?.remoteAddress ?? null;

    const rate = rateLimiter.check(remoteAddress ?? "unknown");
    if (!rate.allowed) {
      return send(res, 429, { error: "rate limit", retryAfterMs: rate.retryAfterMs }, { "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) });
    }

    const cookies = parseCookies(req.headers.cookie);
    try {
      assertSameOrigin(req, { allowedOrigins });
      assertCsrf(req, { secret: sessionSecret, cookies });
    } catch (err) {
      if (err instanceof AuthorizationError) return send(res, err.status, { error: err.message, code: err.code });
      throw err;
    }

    // Defense in depth: uanset hvad ingress måtte have overset, ignorerer
    // servicen klientleverede identitetsheadere.
    const cleanHeaders = stripIdentityHeaders(req.headers);

    let principal;
    try {
      principal = await authenticator.authenticate(cleanHeaders.authorization ?? req.headers.authorization, cleanHeaders, {
        peerCertificate: typeof req.socket?.getPeerCertificate === "function" ? safePeerCertificate(req.socket) : null,
        remoteAddress,
      });
    } catch (err) {
      if (err instanceof AuthenticationError) return send(res, err.status, { error: err.message, code: err.code });
      throw err;
    }

    let body = {};
    try {
      if (req.method !== "GET" && req.method !== "HEAD") body = await readBody(req, { maxBytes });
    } catch (err) {
      if (err instanceof PayloadTooLargeError) return send(res, err.status, { error: err.message, code: err.code });
      if (err instanceof RequestError) return send(res, err.status, { error: err.message, code: err.code });
      throw err;
    }

    try {
      const result = await handler({ req, principal, body, cookies, headers: cleanHeaders });
      return send(res, result.status ?? 200, result.body ?? {});
    } catch (err) {
      if (err instanceof AuthenticationError || err instanceof AuthorizationError) return send(res, err.status, { error: err.message, code: err.code });
      if (err instanceof RequestError) return send(res, err.status, { error: err.message, code: err.code });
      return send(res, 500, { error: "intern fejl" });
    }
  };
}

function safePeerCertificate(socket) {
  try {
    const cert = socket.getPeerCertificate();
    return cert && Object.keys(cert).length > 0 ? cert : null;
  } catch {
    return null;
  }
}

/** Lille hjælper til tests og lokale tjenester. */
export function startSecureServer(options) {
  const handler = createSecureHandler(options);
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: "intern fejl" });
    });
  });
  return server;
}

export { createPlatformAuthenticator };
