import { test } from "node:test";
import assert from "node:assert/strict";
import { createCsrfToken, createRateLimiter, issueSession, parseCookies, readSession, sessionCookie, verifyCsrfToken } from "../src/session.mjs";

const now = () => Date.UTC(2026, 8, 23, 10, 0, 0);
const secret = "session-secret";

test("session udstedes og læses, og bærer kun verificeret principal", () => {
  const value = issueSession({ principal: { kind: "human", id: "user-1", tenantId: "acme", roles: ["approver"] }, secret, now });
  const session = readSession(value, { secret, now });
  assert.equal(session.id, "user-1");
  assert.equal(session.tenantId, "acme");
  assert.deepEqual(session.roles, ["approver"]);
});

test("manipuleret session afvises", () => {
  const value = issueSession({ principal: { kind: "human", id: "user-1", tenantId: "acme", roles: [] }, secret, now });
  const [payload] = value.split(".");
  const tampered = `${payload}.${Buffer.from("forged").toString("base64url")}`;
  assert.throws(() => readSession(tampered, { secret, now }), /signatur/);
});

test("udløbet session afvises", () => {
  const value = issueSession({ principal: { kind: "human", id: "u", tenantId: "acme" }, secret, ttlSeconds: 1, now: () => now() - 10_000 });
  assert.throws(() => readSession(value, { secret, now }), /udløbet/);
});

test("session-cookie er HttpOnly, Secure og SameSite", () => {
  const cookie = sessionCookie("abc");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
});

test("CSRF-token er bundet til sessionen", () => {
  const value = issueSession({ principal: { kind: "human", id: "u", tenantId: "acme" }, secret, now });
  const csrf = createCsrfToken(value, secret);
  assert.equal(verifyCsrfToken(value, csrf, secret), true);
  assert.equal(verifyCsrfToken(value, "wrong", secret), false);
});

test("rate limiter blokerer efter grænsen", () => {
  let clock = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => clock });
  assert.equal(limiter.check("ip").allowed, true);
  assert.equal(limiter.check("ip").allowed, true);
  assert.equal(limiter.check("ip").allowed, false);
  clock = 1001;
  assert.equal(limiter.check("ip").allowed, true);
});

test("cookies parses", () => {
  assert.deepEqual(parseCookies("a=1; platform_session=xyz; b=2"), { a: "1", platform_session: "xyz", b: "2" });
});
