/**
 * DKC-017 — sensorkatalog, friskhed og sikkerhedsstatus.
 *
 * Hvert signal kommer fra en navngivet sensor med en ejer, et forventet
 * interval, en maksimal alder og en runbook. `observability/sensors.json` er den
 * kanoniske kilde: en sensor der forsvinder, eller en regel der peger på en
 * ukendt sensor, fejler kontrollen — ikke bare visningen.
 *
 * `buildSensorReadings` oversætter konkrete målinger (scannerfund, backup,
 * metrics, audit) til readings med `capturedAt` og status. `securityPosture`
 * samler dem. En forældet eller manglende måling giver `stale`/`missing` og
 * dermed ikke-grøn `overall` — uanset hvad et tidligere `pass` sagde.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshnessFor, statusForReading, overallStatus } from "./freshness.mjs";
import { sensorRegistryProblems } from "../../conformance/src/monitoring.mjs";

export { sensorRegistryProblems };

export const SENSOR_REGISTRY_PATH = "observability/sensors.json";

export function loadSensorRegistry(root) {
  const path = join(root, SENSOR_REGISTRY_PATH);
  if (!existsSync(path)) throw new Error(`Mangler ${SENSOR_REGISTRY_PATH}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Byg én reading for en sensor ud fra en observeret kilde.
 * `source` er `{ capturedAt, status }` eller `null` når målingen mangler.
 */
export function buildReading(sensor, source, now = Date.now()) {
  const observed = source ?? null;
  const fresh = freshnessFor({ capturedAt: observed?.capturedAt, maxAgeSeconds: sensor.maxAgeSeconds, now });
  const status = statusForReading({ freshness: fresh.freshness, findingsStatus: observed?.status ?? null });
  return {
    id: sensor.id,
    source: sensor.source,
    kind: sensor.kind,
    capturedAt: observed?.capturedAt ?? null,
    ageSeconds: fresh.ageSeconds,
    freshness: fresh.freshness,
    status,
    required: sensor.required === true,
    runbook: sensor.runbook,
    ...(observed?.value !== undefined ? { value: observed.value } : {}),
    ...(fresh.reason ? { reason: fresh.reason } : {}),
  };
}

/**
 * Byg readings for alle sensorer.
 *
 * @param {object} opts
 * @param {object} opts.registry   sensorkataloget
 * @param {object} opts.sources    `{ [sensorId]: { capturedAt, status } }`
 * @param {number|Date|string} [opts.now]
 */
export function buildSensorReadings({ registry, sources = {}, now = Date.now() } = {}) {
  return (registry?.sensors ?? []).map((sensor) => buildReading(sensor, sources[sensor.id] ?? null, now));
}

function emptySummary() {
  return { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
}

/** Læg fund-summer sammen fra en SecurityFindings-pakke. */
export function aggregateFindings(reports = []) {
  const summary = emptySummary();
  for (const report of reports) {
    for (const key of ["critical", "high", "medium", "low", "total"]) {
      summary[key] += Number(report?.summary?.[key] ?? 0);
    }
  }
  return summary;
}

/**
 * Sikkerhedsstatus på tværs af sensorer.
 *
 * `overall` er den mest alvorlige status. Et enkelt `stale` eller `missing`
 * gør hele statussen ikke-grøn, og en forældet måling kan ikke skjules bag et
 * frisk `pass` fra en anden sensor.
 */
export function securityPosture({ registry, sources = {}, reports = [], now = Date.now(), generatedAt = null } = {}) {
  const sensors = buildSensorReadings({ registry, sources, now });
  const staleSensorIds = sensors.filter((s) => s.freshness === "stale").map((s) => s.id);
  const missingSensorIds = sensors.filter((s) => s.freshness === "missing").map((s) => s.id);
  const overall = overallStatus(sensors.map((s) => s.status));
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "SecurityPosture",
    generatedAt: generatedAt ?? new Date(typeof now === "number" ? now : Date.parse(now)).toISOString(),
    overall,
    sensors,
    staleSensorIds,
    missingSensorIds,
    findings: aggregateFindings(reports),
    notes: [
      "Kun en frisk måling uden fund giver 'pass'; 'stale' og 'missing' er ikke-grønne.",
      ...staleSensorIds.map((id) => `Sensoren '${id}' er forældet og tælles ikke som grøn.`),
      ...missingSensorIds.map((id) => `Sensoren '${id}' mangler data og tælles ikke som grøn.`),
    ],
  };
}
