/**
 * DKC-018 — integrations- og runtime-prober.
 *
 * De hurtige fixturechecks i conformance-suiten beviser form. Denne kører
 * mod et levende system og producerer en `EvidenceRecord` med mode
 * `integration` eller `runtime`, bundet til commit, image-digest, miljø,
 * upstream-version, run-ID og udløb.
 *
 * Ærlighedsregler:
 *   - er endpointet ikke konfigureret, eller kan det ikke nås, skrives posten
 *     som `not-run` med en begrundelse — aldrig som `pass`,
 *   - en forventet status (fx PDP deny) der ikke indtræffer, giver `fail`,
 *   - kun et faktisk 2xx/forventet svar giver `pass`,
 *   - `artifact.sha256` er en rigtig SHA-256 over den observerede rå hændelse,
 *     ikke en pladsholder.
 *
 * Modulet har ingen runtime-afhængigheder ud over `node:crypto`; `fetchImpl`
 * kan injiceres i tests.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sealRecord, PRODUCTION_MODES } from "../../conformance/src/evidence-mode.mjs";

export const PROBES_PATH = "evidence/probes.json";

export function loadProbeManifest(root) {
  const path = join(root, PROBES_PATH);
  if (!existsSync(path)) throw new Error(`Mangler ${PROBES_PATH}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Strukturelle problemer i probemanifestet (ingen skemafilstørrelse). */
export function probeManifestProblems(manifest) {
  const problems = [];
  if (!Array.isArray(manifest?.probes) || manifest.probes.length === 0) {
    problems.push("probemanifestet skal indeholde mindst én probe");
    return problems;
  }
  const ids = new Set();
  for (const [i, probe] of manifest.probes.entries()) {
    const at = `probes[${i}]`;
    if (!probe.id) problems.push(`${at}: mangler id`);
    if (ids.has(probe.id)) problems.push(`${at}: dubleret id '${probe.id}'`);
    ids.add(probe.id);
    if (!PRODUCTION_MODES.includes(probe.mode)) problems.push(`${at}: moden '${probe.mode}' beviser ikke drift (kræver integration/runtime)`);
    if (!probe.url && !probe.urlEnv) problems.push(`${at}: mangler url/urlEnv`);
    if (!probe.expectStatus && !probe.expectDeny) problems.push(`${at}: mangler expectStatus eller expectDeny`);
  }
  return problems;
}

function endpointFor(probe, env) {
  const base = probe.url ?? (probe.urlEnv ? env[probe.urlEnv] : null);
  if (!base) return null;
  return `${String(base).replace(/\/$/, "")}${probe.path ?? ""}`;
}

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

/**
 * Kør én probe og returnér en forseglet evidenspost. Netværksfejl og manglende
 * konfiguration bliver `not-run`, ikke `pass`.
 *
 * @param {object} probe
 * @param {object} opts
 * @param {object} opts.binding  `{ commit, imageDigest, environment, upstreamVersion }`
 * @param {string} opts.runId
 * @param {object} [opts.env]
 * @param {Function} [opts.fetchImpl]
 * @param {number|Date} [opts.now]
 * @param {number} [opts.ttlDays]
 * @param {object} [opts.producer]
 */
export async function runProbe(probe, { binding, runId, env = process.env, fetchImpl = globalThis.fetch, now = Date.now(), ttlDays = 7, producer = { type: "ci", name: "probe-runner", subject: "process|probe-runner" } } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const capturedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const url = endpointFor(probe, env);

  const base = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EvidenceRecord",
    id: probe.id,
    subject: probe.subject ?? { kind: "component", name: probe.id },
    mode: probe.mode,
    commit: binding.commit,
    imageDigest: binding.imageDigest ?? null,
    environment: binding.environment,
    upstreamVersion: binding.upstreamVersion,
    runId,
    capturedAt,
    expiresAt,
    producer,
    command: ["probe", probe.method ?? "GET", url ?? `env:${probe.urlEnv ?? "?"}${probe.path ?? ""}`],
  };

  // Byg posten med en rigtig digest over den observerede rå hændelse.
  const finish = (result, notes, observation) =>
    sealRecord({
      ...base,
      result,
      notes,
      artifact: { uri: `evidence/generated/${probe.id}.evidence.json`, sha256: sha256(JSON.stringify(observation)) },
    });

  if (!url) {
    return finish("not-run", `endpointet er ikke konfigureret (${probe.urlEnv ?? "url"})`, { configured: false, reason: "missing-endpoint" });
  }

  const expected = probe.expectStatus ?? 200;
  const headers = { ...(probe.body ? { "content-type": "application/json" } : {}), ...(probe.headers ?? {}) };
  let response;
  try {
    response = await fetchImpl(url, {
      method: probe.method ?? "GET",
      headers,
      ...(probe.body ? { body: JSON.stringify(probe.body) } : {}),
    });
  } catch (err) {
    return finish("not-run", `endpointet kunne ikke nås: ${err.message}`, { url, error: err.message });
  }

  const status = response?.status ?? 0;
  let bodyText = "";
  try {
    bodyText = typeof response?.text === "function" ? await response.text() : "";
  } catch {
    bodyText = "";
  }
  const observation = { url, method: probe.method ?? "GET", status, body: bodyText.slice(0, 4096) };

  if (probe.expectDeny) {
    // Negativ bypass-probe: det uautoriserede kald SKAL afvises.
    const denied = status === 401 || status === 403;
    if (denied) return finish("pass", `afvist med HTTP ${status} (forventet deny)`, observation);
    return finish("fail", `forventede deny (401/403), fik HTTP ${status} — direkte kald blev ikke afvist`, observation);
  }

  if (status === expected) {
    if (probe.expectJsonContains && !bodyText.includes(probe.expectJsonContains)) {
      return finish("fail", `HTTP ${status}, men svaret indeholdt ikke '${probe.expectJsonContains}'`, observation);
    }
    return finish("pass", `HTTP ${status}`, observation);
  }
  return finish("fail", `forventede HTTP ${expected}, fik HTTP ${status}`, observation);
}

/**
 * Kør alle prober i manifestet. Returnerer `{ records, summary, ok }`.
 * `ok` er kun sandt når ingen probe fejlede; `not-run` blokerer release-gaten,
 * men er ikke en fejl i selve køreren.
 */
export async function runProbes({ manifest, binding, runId, env = process.env, fetchImpl = globalThis.fetch, now = Date.now(), ttlDays } = {}) {
  const records = [];
  for (const probe of manifest.probes ?? []) {
    records.push(await runProbe(probe, { binding, runId, env, fetchImpl, now, ttlDays: ttlDays ?? manifest.ttlDays, producer: { type: "ci", name: "probe-runner", subject: `ci|${runId}` } }));
  }
  const summary = { total: records.length, pass: 0, fail: 0, "not-run": 0 };
  for (const r of records) summary[r.result] = (summary[r.result] ?? 0) + 1;
  return { records, summary, ok: summary.fail === 0 };
}
