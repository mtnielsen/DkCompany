/**
 * DKC-003 — sessioner, CSRF, inputgrænser og rate limits.
 *
 * Sessioner er signerede cookies (HttpOnly, Secure, SameSite). Cookies alene
 * er ikke nok mod CSRF, så usikre metoder kræver et CSRF-token bundet til
 * sessionen. Requests har et hårdt størrelsesloft, og rate limiting er
 * per nøgle.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthenticationError, AuthorizationError } from "./errors.mjs";

export class RequestError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

export class PayloadTooLargeError extends RequestError {
  constructor(message = "request body er for stor") {
    super(message, { status: 413, code: "payload_too_large" });
  }
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a ?? "");
  const bufB = Buffer.from(b ?? "");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function issueSession({ principal, secret, ttlSeconds = 3600, now = () => Date.now() }) {
  if (!secret) throw new Error("session secret mangler");
  const payload = Buffer.from(JSON.stringify({
    sub: principal.id,
    kind: principal.kind,
    tenantId: principal.tenantId,
    roles: principal.roles ?? [],
    exp: Math.floor(now() / 1000) + ttlSeconds,
  })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSession(value, { secret, now = () => Date.now() }) {
  const [payload, signature] = String(value ?? "").split(".");
  if (!payload || !signature) throw new AuthenticationError("ugyldig session");
  if (!safeEqual(signature, sign(payload, secret))) throw new AuthenticationError("ugyldig sessionssignatur");
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new AuthenticationError("kunne ikke afkode session");
  }
  if (typeof data.exp === "number" && data.exp < Math.floor(now() / 1000)) throw new AuthenticationError("sessionen er udløbet");
  return { kind: data.kind, id: data.sub, tenantId: data.tenantId, roles: data.roles ?? [] };
}

export function sessionCookie(value, { secure = true, sameSite = "Strict", maxAgeSeconds = 3600, name = "platform_session" } = {}) {
  const attrs = ["HttpOnly", `SameSite=${sameSite}`, "Path=/", `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push("Secure");
  return `${name}=${value}; ${attrs.join("; ")}`;
}

export function clearSessionCookie({ secure = true, name = "platform_session" } = {}) {
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** CSRF-token bundet til sessionen (double-submit). */
export function createCsrfToken(sessionValue, secret) {
  return sign(`csrf:${sessionValue}`, secret);
}

export function verifyCsrfToken(sessionValue, token, secret) {
  return safeEqual(token, createCsrfToken(sessionValue, secret));
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Afvis cross-origin writes. Same-origin eller eksplicit tilladte origins. */
export function assertSameOrigin(req, { allowedOrigins = [] } = {}) {
  if (!UNSAFE_METHODS.has(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return; // ikke en browser-baseret request; identitet bæres af token
  const allowed = new Set(allowedOrigins);
  const host = req.headers.host;
  if (origin === `https://${host}` || origin === `http://${host}`) return;
  if (allowed.has(origin)) return;
  throw new AuthorizationError(`cross-origin write fra '${origin}' er ikke tilladt`, { status: 403, code: "cross_origin" });
}

/** CSRF-krav for cookie-baserede writes. Token kan komme i header eller form. */
export function assertCsrf(req, { secret, cookies = {} } = {}) {
  if (!UNSAFE_METHODS.has(req.method)) return;
  const sessionValue = cookies.platform_session;
  if (!sessionValue) return; // ingen cookie-session; token-baseret identitet
  const token = req.headers["x-csrf-token"];
  if (!verifyCsrfToken(sessionValue, token, secret)) {
    throw new AuthorizationError("manglende eller ugyldigt CSRF-token", { status: 403, code: "csrf" });
  }
}

/** Simpel token-bucket/rate-limiter pr. nøgle. */
export function createRateLimiter({ limit = 60, windowMs = 60_000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  return {
    check(key) {
      const current = now();
      const entry = buckets.get(key);
      if (!entry || current - entry.startedAt >= windowMs) {
        buckets.set(key, { startedAt: current, count: 1 });
        return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
      }
      entry.count += 1;
      if (entry.count > limit) {
        return { allowed: false, remaining: 0, retryAfterMs: entry.startedAt + windowMs - current };
      }
      return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0 };
    },
  };
}

/** Læs body med et hårdt loft; afbryder forbindelsen ved overskridelse. */
export function readBody(req, { maxBytes = 256 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let finished = false;
    req.on("data", (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > maxBytes) {
        finished = true;
        // Dræn resten i stedet for atødelægge socket'en, så klienten kan få 413.
        req.resume();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new RequestError(`ugyldig JSON: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
