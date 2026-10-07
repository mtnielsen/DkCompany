import { test } from "node:test";
import assert from "node:assert/strict";
import { freshnessFor, statusForReading, overallStatus, isGreen } from "../src/freshness.mjs";
import { loadSensorRegistry, buildSensorReadings, securityPosture } from "../src/sensors.mjs";
import { sensorRegistryProblems } from "../../conformance/src/monitoring.mjs";

const root = new URL("../..", import.meta.url).pathname;
const now = Date.parse("2025-09-01T12:00:00Z");

test("freshnessFor skelner frisk, forældet og manglende", () => {
  assert.equal(freshnessFor({ capturedAt: "2025-09-01T11:59:00Z", maxAgeSeconds: 300, now }).freshness, "fresh");
  assert.equal(freshnessFor({ capturedAt: "2025-09-01T11:00:00Z", maxAgeSeconds: 300, now }).freshness, "stale");
  assert.equal(freshnessFor({ capturedAt: null, maxAgeSeconds: 300, now }).freshness, "missing");
  assert.equal(freshnessFor({ capturedAt: "ikke-en-dato", maxAgeSeconds: 300, now }).freshness, "missing");
});

test("en forældet eller manglende måling tilsidesætter et tidligere pass", () => {
  assert.equal(statusForReading({ freshness: "stale", findingsStatus: "pass" }), "stale");
  assert.equal(statusForReading({ freshness: "missing", findingsStatus: "pass" }), "missing");
  assert.equal(statusForReading({ freshness: "fresh", findingsStatus: "pass" }), "pass");
  assert.equal(statusForReading({ freshness: "fresh", findingsStatus: null }), "unknown");
  assert.equal(isGreen("stale"), false);
  assert.equal(isGreen("pass"), true);
});

test("overallStatus vælger den mest alvorlige status og er ikke grøn for tomt sæt", () => {
  assert.equal(overallStatus(["pass", "partial"]), "partial");
  assert.equal(overallStatus(["partial", "fail"]), "fail");
  assert.equal(overallStatus(["pass", "stale"]), "stale");
  assert.equal(overallStatus([]), "unknown");
});

test("sensorkataloget er semantisk gyldigt", () => {
  const registry = loadSensorRegistry(root);
  assert.equal(sensorRegistryProblems(registry, { root }).length, 0);
  assert.ok(registry.sensors.length >= 5);
  assert.ok(registry.sensors.some((s) => s.tenantScoped));
});

test("gamle eller manglende sensordata giver ikke grøn sikkerhedsstatus", () => {
  const registry = loadSensorRegistry(root);
  const fresh = new Date(now).toISOString();
  const allFresh = Object.fromEntries(registry.sensors.map((s) => [s.id, { capturedAt: fresh, status: "pass", value: 1 }]));
  const healthy = securityPosture({ registry, sources: allFresh, now });
  assert.equal(healthy.overall, "pass");

  const stale = securityPosture({ registry, sources: { ...allFresh, "trivy-fs": { capturedAt: "2025-08-01T00:00:00Z", status: "pass" } }, now });
  assert.notEqual(stale.overall, "pass");
  assert.ok(stale.staleSensorIds.includes("trivy-fs"));

  const missing = securityPosture({ registry, sources: Object.fromEntries(Object.entries(allFresh).filter(([id]) => id !== "wazuh-siem")), now });
  assert.notEqual(missing.overall, "pass");
  assert.ok(missing.missingSensorIds.includes("wazuh-siem"));
});

test("buildSensorReadings kopierer værdi og friskhed", () => {
  const registry = { sensors: [{ id: "s1", source: "prometheus", kind: "metrics", maxAgeSeconds: 300, required: true, runbook: "docs/runbooks/alerting.md" }] };
  const [reading] = buildSensorReadings({ registry, sources: { s1: { capturedAt: new Date(now).toISOString(), status: "pass", value: 0.5 } }, now });
  assert.equal(reading.value, 0.5);
  assert.equal(reading.freshness, "fresh");
  assert.equal(reading.status, "pass");
});
