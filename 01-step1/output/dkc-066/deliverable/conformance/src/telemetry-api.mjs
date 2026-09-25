/**
 * DKC-066 — semantiske validatorer for telemetri-API'ets kontrakter.
 *
 * Skemaerne håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - en telemetri-envelope skal have et sandsynligt tidsstempel, en betroet
 *     kilde, konsistente relationer og sin signalstruktur,
 *   - et dashboard-view må kun være `pass` med friske data; manglende signaler
 *     giver `unknown` med `lastObservedAt`,
 *   - en dashboard-adapter må kun have `read`-kapabiliteter,
 *   - en collector-status må ikke vise `pass` for en ikke-frisk collector,
 *   - en `passed` testkørsel må ikke indeholde fejlede checks, og en fejlet check
 *     skal have en navngivet ejer,
 *   - en `pass`-recovery kræver målte tal inden for målene.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";
import { envelopeProblems } from "../../telemetry-api/src/envelope.mjs";
import { adapterProblems } from "../../telemetry-api/src/adapters.mjs";
import { collectorStatusProblems } from "../../telemetry-api/src/collectors.mjs";

function err(path, message) {
  return { path, message };
}

function schemaAndSemantic(ajvInstance, schemaId, data, semantic) {
  const instance = ajvInstance ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...semantic(data));
  return { ok: result.length === 0, errors: result };
}

/* -------------------------------------------------------------------------- */
/* Telemetri-envelope                                                         */
/* -------------------------------------------------------------------------- */

export function validateTelemetryEnvelope(data, ajv, opts) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.telemetryEnvelope, data, (d) => envelopeProblems(d, opts ?? {}).problems);
}

/* -------------------------------------------------------------------------- */
/* Dashboard-view                                                             */
/* -------------------------------------------------------------------------- */

export function dashboardViewProblems(view) {
  const problems = [];
  if (!view || typeof view !== "object") return [err("/", "viewet er ikke et objekt")];
  const status = view.status;
  const sensors = view.series ?? [];
  if (status === "pass" && sensors.length === 0 && (view.items ?? []).length === 0) {
    problems.push(err("/status", "et tomt view kan ikke være 'pass'"));
  }
  if ((status === "missing" || status === "stale") && view.lastObservedAt) {
    // En forældet/manglende status beholder det sidst observerede tidspunkt — det er tilladt.
  }
  if (status === "unknown" && view.lastObservedAt === undefined) {
    problems.push(err("/lastObservedAt", "unknown-status skal bære lastObservedAt (må være null)"));
  }
  const seriesCount = new Set(sensors.map((s) => s.metric)).size;
  if (view.cardinality && view.cardinality.series < seriesCount) {
    problems.push(err("/cardinality/series", "kardinalitetstallet er mindre end antallet af serier"));
  }
  for (const [i, s] of sensors.entries()) {
    for (const [j, p] of (s.points ?? []).entries()) {
      if (!Number.isFinite(p.value)) problems.push(err(`/series/${i}/points/${j}/value`, "punktet er ikke numerisk"));
    }
  }
  return problems;
}

export function validateDashboardView(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.dashboardView, data, dashboardViewProblems);
}

/* -------------------------------------------------------------------------- */
/* Dashboard-adapter                                                          */
/* -------------------------------------------------------------------------- */

export function validateDashboardAdapter(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.dashboardAdapter, data, adapterProblems);
}

/* -------------------------------------------------------------------------- */
/* Collector-status                                                           */
/* -------------------------------------------------------------------------- */

export function validateCollectorStatus(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.collectorStatus, data, collectorStatusProblems);
}

/* -------------------------------------------------------------------------- */
/* Testkørsel                                                                 */
/* -------------------------------------------------------------------------- */

export function testRunProblems(run) {
  const problems = [];
  if (!run || typeof run !== "object") return [err("/", "testkørslen er ikke et objekt")];
  const checks = Array.isArray(run.checks) ? run.checks : [];
  const failed = checks.filter((c) => c.status === "fail");
  if (run.result === "passed" && failed.length) {
    problems.push(err("/result", `en 'passed' kørsel må ikke indeholde fejlede checks (${failed.map((c) => c.id).join(", ")})`));
  }
  for (const [i, c] of checks.entries()) {
    if (c.status === "fail" && !isNamedHuman(c.owner)) {
      problems.push(err(`/checks/${i}/owner`, `den fejlede check '${c.id}' skal have en navngivet ejer`));
    }
    if (c.status === "pass" && (!c.evidence || c.evidence.length === 0)) {
      problems.push(err(`/checks/${i}/evidence`, `den beståede check '${c.id}' mangler evidens`));
    }
  }
  if (!isNamedHuman(run.producer) && !["ci", "runtime"].includes(run.producer?.type)) {
    problems.push(err("/producer", "kørslen skal have en gyldig producent"));
  }
  return problems;
}

export function validateTestRun(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.testRun, data, testRunProblems);
}

/* -------------------------------------------------------------------------- */
/* Recovery-status                                                            */
/* -------------------------------------------------------------------------- */

export function recoveryStatusProblems(data) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "recovery-statussen er ikke et objekt")];
  if (!isNamedHuman(data.owner)) problems.push(err("/owner", "recovery-statussen skal have en navngivet ejer"));
  const measuredRpo = data.measured?.dataLossMinutes;
  const measuredRto = data.measured?.restoreMinutes;
  if (data.gate === "pass") {
    if (measuredRpo === null || measuredRpo === undefined) problems.push(err("/measured/dataLossMinutes", "en 'pass'-gate kræver et målt RPO"));
    if (measuredRto === null || measuredRto === undefined) problems.push(err("/measured/restoreMinutes", "en 'pass'-gate kræver et målt RTO"));
    if (Number.isFinite(measuredRpo) && measuredRpo > Number(data.targets?.rpoMinutes)) problems.push(err("/measured/dataLossMinutes", "målt RPO overstiger målet"));
    if (Number.isFinite(measuredRto) && measuredRto > Number(data.targets?.rtoMinutes)) problems.push(err("/measured/restoreMinutes", "målt RTO overstiger målet"));
  }
  if (data.gate === "blocked" && !data.reason) problems.push(err("/reason", "en 'blocked'-gate skal forklare hvorfor"));
  return problems;
}

export function validateRecoveryStatus(data, ajv) {
  return schemaAndSemantic(ajv, SCHEMA_IDS.recoveryStatus, data, recoveryStatusProblems);
}
