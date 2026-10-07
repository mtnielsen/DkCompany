import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestTelemetry, minimizePayload, queryTelemetry, telemetryCounts, assertPseudonymousSubject } from "../src/telemetry.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";

const raw = (overrides = {}) => ({
  id: "tel-1",
  signal: "metric",
  tenantId: "acme",
  source: { type: "metric", name: "prometheus" },
  capturedAt: "2025-09-01T10:00:00Z",
  subject: { kind: "service", name: "module:dummy-ok" },
  metric: { name: "http_requests_total", value: 12 },
  attributes: { module: "dummy-ok", email: "kunde@example.org", phone: "12345678", authorization: "Bearer hemmelig" },
  ...overrides,
});

test("minimizePayload fjerner persondata og hemmeligheder og bevarer en digest", () => {
  const { operational, removed, redactions, personalDigest } = minimizePayload({
    module: "dummy-ok",
    email: "kunde@example.org",
    nested: { token: "hemmelig", cpr: "010190-1234" },
  });
  assert.equal(operational.module, "dummy-ok");
  assert.equal(operational.email, "[MINIMIZED]");
  assert.equal(operational.nested.token, "[REDACTED]");
  assert.equal(operational.nested.cpr, "[MINIMIZED]");
  assert.ok(removed.includes("/email"));
  assert.ok(removed.includes("/nested/cpr"));
  assert.ok(redactions.includes("/nested/token"));
  assert.match(personalDigest, /^[a-f0-9]{64}$/);
});

test("ingestTelemetry minimerer attributter og sætter minimized", () => {
  const [record] = ingestTelemetry([raw()]);
  assert.equal(record.minimized, true);
  assert.equal(record.attributes.email, "[MINIMIZED]");
  assert.equal(record.attributes.phone, "[MINIMIZED]");
  assert.equal(record.attributes.authorization, "[REDACTED]");
  assert.equal(record.attributes.module, "dummy-ok");
  assert.equal(record.metric.name, "http_requests_total");
  assert.ok(record.personalData.removed.includes("attributes/email"));
  assert.match(record.personalData.digest, /^[a-f0-9]{64}$/);
});

test("en rå personidentifikator i emnet afvises", () => {
  assert.throws(() => assertPseudonymousSubject({ kind: "human", name: "kunde@example.org" }), /personidentifikator/);
  assert.throws(() => ingestTelemetry([raw({ subject: { kind: "human", name: "kunde@example.org" } })]), /personidentifikator/);
});

test("ingestTelemetry afviser ukendte tenanter og manglende signalblok", () => {
  assert.throws(() => ingestTelemetry([raw({ tenantId: "globex" })], { knownTenants: new Set(["acme"]) }), /ukendte tenant/);
  assert.throws(() => ingestTelemetry([raw({ signal: "log", metric: undefined })]), /log/);
});

test("en kunde kan ikke se en andens telemetri", () => {
  const records = ingestTelemetry([
    raw({ id: "acme-1", tenantId: "acme" }),
    raw({ id: "globex-1", tenantId: "globex" }),
  ]);
  const acmeUser = { id: "oidc|acme-user", tenantId: "acme" };
  const own = queryTelemetry({ principal: acmeUser, records });
  assert.deepEqual(own.records.map((r) => r.id), ["acme-1"]);
  assert.throws(() => queryTelemetry({ principal: acmeUser, requestedTenantId: "globex", records }), AuthorizationError);
  assert.throws(() => queryTelemetry({ principal: acmeUser, requestedTenantId: "globex", records }), /matcher ikke/);
});

test("kun en scopet platformrolle kan læse på tværs af kunder", () => {
  const records = ingestTelemetry([
    raw({ id: "acme-1", tenantId: "acme" }),
    raw({ id: "globex-1", tenantId: "globex" }),
  ]);
  const admin = { id: "oidc|platform-admin", roles: ["platform-admin", "platform-admin:globex"] };
  const result = queryTelemetry({ principal: admin, requestedTenantId: "globex", records });
  assert.equal(result.crossTenant, true);
  assert.deepEqual(result.records.map((r) => r.id), ["globex-1"]);
  const unscoped = { id: "oidc|platform-admin", roles: ["platform-admin"] };
  assert.throws(() => queryTelemetry({ principal: unscoped, requestedTenantId: "globex", records }), AuthorizationError);
});

test("telemetryCounts tæller pr. signal uden at blande tenanter", () => {
  const records = ingestTelemetry([
    raw({ id: "m", signal: "metric", metric: { name: "x", value: 1 } }),
    raw({ id: "l", signal: "log", metric: undefined, log: { event: "started" } }),
    raw({ id: "t", signal: "trace", metric: undefined, trace: { traceId: "a", spanId: "b", durationMs: 3, status: "ok" } }),
  ]);
  assert.deepEqual(telemetryCounts(records), { metric: 1, log: 1, trace: 1 });
});
