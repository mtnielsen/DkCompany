import { test } from "node:test";
import assert from "node:assert/strict";
import { envelopeProblems, envelopeDigest, trustedSources, SUPPORTED_SCHEMA_VERSIONS } from "../src/envelope.mjs";
import { makeEnvelope, registry, NOW } from "./support/fixtures.mjs";

const opts = { now: NOW + 1000, registry };

test("en gyldig metrik-envelope accepteres og får en korrelation", () => {
  const result = envelopeProblems(makeEnvelope(), opts);
  assert.deepEqual(result.problems, []);
  assert.equal(result.trusted, true);
  assert.equal(result.late, false);
  assert.equal(result.correlation.nodes.length, 3);
});

test("kun kendte, betroede kilder accepteres", () => {
  const unknown = envelopeProblems(makeEnvelope({ source: { id: "ukendt-collector", kind: "otel" } }), opts);
  assert.ok(unknown.problems.some((p) => /ikke registreret som betroet/.test(p.message)));
  const untrustedRegistry = { sources: [{ id: "otel-collector", kind: "otel", trusted: false, expectedIntervalSeconds: 30, maxAgeSeconds: 300 }], bounds: { maxEnvelopesPerSecond: 1, maxBuffer: 1, maxCardinality: 1, maxEnvelopeBytes: 10 } };
  assert.equal(trustedSources(untrustedRegistry).size, 0);
});

test("fremtidige tidsstempler afvises og forældede markeres late", () => {
  const future = envelopeProblems(makeEnvelope({ occurredAt: new Date(NOW + 10 * 60 * 1000).toISOString() }), opts);
  assert.ok(future.problems.some((p) => p.path === "/occurredAt"));
  const old = envelopeProblems(makeEnvelope({ occurredAt: new Date(NOW - 2 * 3600 * 1000).toISOString() }), opts);
  assert.deepEqual(old.problems, []);
  assert.equal(old.late, true);
});

test("ukendt schemaVersion og manglende signalstruktur afvises", () => {
  const badVersion = envelopeProblems(makeEnvelope({ schemaVersion: "9.9" }), opts);
  assert.ok(badVersion.problems.some((p) => p.path === "/schemaVersion"));
  assert.ok(SUPPORTED_SCHEMA_VERSIONS.includes("1.0"));
  const noMetric = envelopeProblems(makeEnvelope({ otel: {} }), opts);
  assert.ok(noMetric.problems.some((p) => p.path.startsWith("/otel")));
  const traceNoIds = envelopeProblems(makeEnvelope({ signal: "trace", otel: { attributes: {} } }), opts);
  assert.ok(traceNoIds.problems.some((p) => p.path === "/otel"));
  const findingNoRef = envelopeProblems(makeEnvelope({ signal: "finding", otel: undefined }), opts);
  assert.ok(findingNoRef.problems.some((p) => p.path === "/ref"));
});

test("en relation der krydser tenant afvises", () => {
  const bad = envelopeProblems(makeEnvelope({ relations: { incident: "res://globex/incident/1" } }), opts);
  assert.ok(bad.problems.some((p) => /krydser tenant/.test(p.message)));
});

test("digesten ændrer sig med indholdet", () => {
  const a = makeEnvelope();
  const b = makeEnvelope({ id: "env-2" });
  assert.notEqual(envelopeDigest(a), envelopeDigest(b));
  assert.equal(envelopeDigest(a), envelopeDigest(JSON.parse(JSON.stringify(a))));
});
