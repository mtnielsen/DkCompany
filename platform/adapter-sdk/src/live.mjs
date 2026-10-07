/**
 * DKC-024 — live integrationskører for adaptere mod rigtige upstream-instanser.
 *
 * Denne kører er den ærlige bro mellem mock-testen (DKC-023) og et rigtigt
 * kundemiljø. Den læser bindinger fra miljøet, kalder adapterens dokumenterede
 * flade og skriver en `EvidenceRecord` med mode `integration` for hver prøve.
 *
 * Ærlighedsreglerne er de samme som DKC-018:
 *   - er bindingen ikke sat, eller kan endpointet ikke nås, bliver posten
 *     `not-run` med en begrundelse — aldrig `pass`,
 *   - et svar der ikke matcher den forventede status, eller et privacy-verbum
 *     der erklærer `partial` men svarer `partial: false`, bliver `fail`,
 *   - en version/edition uden for den pinnede releaseprofil afvises, før
 *     opgraderingen kan godkendes.
 *
 * Modulet har ingen netværksafhængigheder ud over `fetch`, som kan injiceres i
 * tests.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sealRecord } from "../../conformance/src/evidence-mode.mjs";
import { negotiateUpstreamVersion } from "./version.mjs";

export const LIVE_TARGETS_PATH = "adapter-sdk/live-targets.json";

export function loadLiveTargets(root) {
  const path = join(root, LIVE_TARGETS_PATH);
  if (!existsSync(path)) throw new Error(`Mangler ${LIVE_TARGETS_PATH}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

const ENV_NAME = /^[A-Z][A-Z0-9_]+$/;

function targetProblems(target, { releaseProfile = null, candidate = null, manifest = null } = {}) {
  const problems = [];
  const at = (m) => `${target?.id ?? "?"}: ${m}`;
  if (!target?.id) problems.push(at("mangler id"));
  if (!target?.module) problems.push(at("mangler module"));
  if (!target?.releaseProfile) problems.push(at("mangler releaseProfile"));
  if (!target?.candidate) problems.push(at("mangler candidate"));
  if (!target?.pinned?.version) problems.push(at("mangler pinned.version"));
  if (!("edition" in (target?.pinned ?? {}))) problems.push(at("mangler pinned.edition"));
  for (const [key, value] of Object.entries(target?.bindings ?? {})) {
    if (!ENV_NAME.test(String(value))) problems.push(at(`binding '${key}' er ikke et miljøvariabelnavn`));
  }
  if (!target?.bindings?.adapterUrl) problems.push(at("mangler bindings.adapterUrl"));
  if (!target?.scopes?.required?.length) problems.push(at("mangler scopes.required"));
  if (target?.scopes?.leastPrivilege !== true) problems.push(at("skal erklære leastPrivilege: true"));
  if (target?.rateLimits?.documented !== true) problems.push(at("rateLimits skal være dokumenteret"));
  if (!target?.rateLimits?.handling) problems.push(at("rateLimits.handling mangler"));
  if (!target?.residualData?.erase || !target?.residualData?.holds) problems.push(at("residualData skal beskrive erase og holds"));
  if (target?.identity?.requiredCentralIdentity !== true) problems.push(at("skal kræve central identitet"));

  // Pinning skal matche den godkendte releaseprofil.
  if (releaseProfile) {
    if (target.pinned?.version !== releaseProfile.upstream?.exactVersion) {
      problems.push(at(`pinned.version '${target.pinned?.version}' matcher ikke releaseprofilens '${releaseProfile.upstream?.exactVersion}'`));
    }
    if ((target.pinned?.edition ?? null) !== (releaseProfile.upstream?.edition ?? null)) {
      problems.push(at(`pinned.edition '${target.pinned?.edition}' matcher ikke releaseprofilens '${releaseProfile.upstream?.edition}'`));
    }
    if (target.identity?.requiredCentralIdentity === true && !releaseProfile.approvalGate?.requiredSso) {
      problems.push(at("kræver central identitet, men releaseprofilen kræver ikke obligatorisk SSO"));
    }
  }
  if (candidate && candidate.sso?.supported !== true) problems.push(at("kandidaten understøtter ikke SSO, men live-køren kræver central identitet"));

  const checks = target?.checks ?? [];
  if (!checks.length) problems.push(at("skal have mindst én live-prøve"));
  const ids = new Set();
  for (const [i, c] of checks.entries()) {
    if (!c.id) problems.push(at(`checks[${i}] mangler id`));
    else if (ids.has(c.id)) problems.push(at(`checks[${i}] dubleret id '${c.id}'`));
    ids.add(c.id);
    if (!["adapter", "upstream"].includes(c.base)) problems.push(at(`checks[${i}].base skal være adapter|upstream`));
    if (!c.method) problems.push(at(`checks[${i}].method mangler`));
    if (!c.path) problems.push(at(`checks[${i}].path mangler`));
  }

  // Hvert privacy-verbum med en adapter-endpoint skal have en prøve, og
  // forventningen om partial/full skal matche releaseprofilen. Endpointet
  // læses fra modulmanifestet, fordi releaseprofilen kun bærer endpointet for
  // `full`-verber.
  const privacySource = manifest?.privacy ?? releaseProfile?.privacyMatrix ?? {};
  if (releaseProfile || manifest) {
    for (const [verb, block] of Object.entries(privacySource)) {
      if (!block?.endpoint) continue;
      const check = checks.find((c) => c.verb === verb);
      if (!check) {
        problems.push(at(`privacy-verbet '${verb}' har endpoint men ingen live-prøve`));
        continue;
      }
      const declared = releaseProfile?.privacyMatrix?.[verb]?.conformance ?? block.conformance;
      if (declared === "partial" && check.expectPartial !== true) {
        problems.push(at(`privacy-verbet '${verb}' er erklæret partial, men prøven forventer ikke partial: true`));
      }
      if (declared === "full" && check.expectPartial === true) {
        problems.push(at(`privacy-verbet '${verb}' er erklæret full, men prøven forventer partial`));
      }
    }
    // En prøve må ikke påstå et verbum releaseprofilen ikke kender.
    for (const c of checks) {
      if (c.verb && !releaseProfile?.privacyMatrix?.[c.verb] && !privacySource?.[c.verb]) problems.push(at(`prøven '${c.id}' refererer det ukendte privacy-verbum '${c.verb}'`));
    }
  }
  return problems;
}

/**
 * Validér alle live-mål mod deres releaseprofiler og kandidater.
 * `load` giver `{ profile, candidate }` pr. target.
 */
export function liveTargetsProblems(manifest, { load = null } = {}) {
  const problems = [];
  if (!manifest?.targets?.length) return ["live-targets.json skal indeholde mindst ét target"];
  const seen = new Set();
  for (const target of manifest.targets) {
    if (seen.has(target.id)) problems.push(`dubleret target-id '${target.id}'`);
    seen.add(target.id);
    const inputs = load ? load(target) : {};
    problems.push(...targetProblems(target, { releaseProfile: inputs.releaseProfile ?? inputs.profile ?? null, candidate: inputs.candidate ?? null, manifest: inputs.manifest ?? null }));
  }
  return problems;
}

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function tally(checks) {
  const summary = { total: checks.length, pass: 0, fail: 0, "not-run": 0, skip: 0 };
  for (const c of checks) summary[c.status] = (summary[c.status] ?? 0) + 1;
  return summary;
}

function evidenceRecord({ target, spec, binding, capturedAt, expiresAt, runId, producer, result, notes, observation }) {
  if (!binding?.commit) return null;
  return sealRecord({
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EvidenceRecord",
    id: `${target.id}-${spec.id}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-"),
    subject: { kind: "verb", name: target.module, verb: spec.verb ?? spec.id },
    mode: spec.mode ?? "integration",
    result,
    commit: binding.commit,
    imageDigest: binding.imageDigest ?? null,
    environment: binding.environment ?? "staging",
    upstreamVersion: `${target.module}@${target.pinned?.version ?? "unknown"}`,
    runId,
    capturedAt,
    expiresAt,
    producer,
    command: ["adapter-live", spec.method ?? "GET", `${spec.base ?? "adapter"}${spec.path ?? ""}`],
    artifact: { uri: `evidence/generated/live-${target.id}-${spec.id}.json`, sha256: sha256(JSON.stringify(observation ?? {})) },
    notes,
  });
}

async function runLiveCheck({ target, spec, releaseProfile, env, fetchImpl, binding, capturedAt, expiresAt, runId, producer }) {
  const base = spec.base === "upstream" ? env[target.bindings?.upstreamUrl] : env[target.bindings?.adapterUrl];
  const envName = spec.base === "upstream" ? target.bindings?.upstreamUrl : target.bindings?.adapterUrl;
  const assertion = target.bindings?.assertion ? env[target.bindings.assertion] : null;

  const finish = (status, detail, observation = {}) => ({
    check: { id: spec.id, base: spec.base, verb: spec.verb ?? null, status, detail },
    record: evidenceRecord({ target, spec, binding, capturedAt, expiresAt, runId, producer, result: status, notes: detail, observation }),
  });

  if (!base) return finish("not-run", `bindingen '${envName}' er ikke sat`);

  const url = `${String(base).replace(/\/$/, "")}${spec.path}`;
  const headers = { "content-type": "application/json", ...(spec.base === "adapter" && assertion ? { "x-platform-assertion": assertion } : {}) };
  let response;
  try {
    response = await fetchImpl(url, { method: spec.method ?? "GET", headers, ...(spec.body ? { body: JSON.stringify(spec.body) } : {}) });
  } catch (err) {
    return finish("not-run", `endpointet kunne ikke nås: ${err.message}`, { url, error: err.message });
  }
  const status = response?.status ?? 0;
  let text = "";
  try {
    text = typeof response?.text === "function" ? await response.text() : "";
  } catch {
    text = "";
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const observation = { url, method: spec.method ?? "GET", status, body: text.slice(0, 4096) };

  if (spec.expectStatus !== undefined && status !== spec.expectStatus) {
    return finish("fail", `forventede HTTP ${spec.expectStatus}, fik HTTP ${status}`, observation);
  }

  // Privacy-ærlighed: erklæret partial må ikke svare partial: false.
  const declared = spec.verb ? releaseProfile?.privacyMatrix?.[spec.verb]?.conformance : null;
  const bodyPartial = json?.result?.partial ?? json?.partial;
  if (declared === "partial" && bodyPartial !== true) {
    return finish("fail", `releaseprofilen erklærer '${spec.verb}' partial, men adapteren svarede partial=${bodyPartial}`, observation);
  }
  if (declared === "full" && bodyPartial === true) {
    return finish("fail", `releaseprofilen erklærer '${spec.verb}' full, men adapteren svarede partial=true`, observation);
  }
  if (spec.expectJsonContains && !text.includes(spec.expectJsonContains)) {
    return finish("fail", `HTTP ${status}, men svaret indeholdt ikke '${spec.expectJsonContains}'`, observation);
  }
  return finish("pass", `HTTP ${status}${declared ? ` (${spec.verb}: ${declared})` : ""}`, observation);
}

/**
 * Kør alle live-prøver for ét target og returnér checks + evidensposter.
 * `ok` er kun sandt når ingen prøve fejlede; `not-run` blokerer en release-gate,
 * men er ikke i sig selv en fejl i køreren.
 */
export async function runLiveTarget({
  target,
  releaseProfile = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  binding = {},
  runId = "adapter-live",
  now = Date.now(),
  ttlDays = 7,
  producer = { type: "ci", name: "adapter-live", subject: "ci|adapter-live" },
  log = () => {},
} = {}) {
  if (!target) throw new Error("runLiveTarget kræver et target");
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const capturedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const checks = [];
  const records = [];
  for (const spec of target.checks ?? []) {
    const { check, record } = await runLiveCheck({ target, spec, releaseProfile, env, fetchImpl, binding, capturedAt, expiresAt, runId, producer });
    checks.push(check);
    if (record) records.push(record);
  }

  // Versionsforhandling: brug den pinnede version mod releaseprofilen og, når
  // upstream-bindingen findes, den faktisk observerede version.
  let negotiation = null;
  if (releaseProfile) {
    negotiation = negotiateUpstreamVersion({
      upstreamVersion: target.pinned?.version,
      edition: target.pinned?.edition,
      supportedRanges: releaseProfile.negotiation?.supportedRanges ?? [],
      supportedEditions: releaseProfile.negotiation?.supportedEditions ?? [],
      onUnsupported: releaseProfile.negotiation?.onUnsupported ?? "refuse",
    });
    checks.push({ id: "negotiation", base: "contract", verb: null, status: negotiation.status === "supported" ? "pass" : "fail", detail: negotiation.reason });
  }

  const summary = tally(checks);
  const report = { target: target.id, generatedAt: capturedAt, checks, records, negotiation, summary, ok: summary.fail === 0 };
  log(report);
  return report;
}

export async function runAllLiveTargets({ manifest, load, env = process.env, fetchImpl = globalThis.fetch, binding = {}, runId = "adapter-live", now = Date.now(), log = () => {} } = {}) {
  const reports = [];
  for (const target of manifest?.targets ?? []) {
    const releaseProfile = load ? load(target)?.profile ?? null : null;
    reports.push(await runLiveTarget({ target, releaseProfile, env, fetchImpl, binding, runId, now, ttlDays: manifest.ttlDays ?? 7, log }));
  }
  const summary = { targets: reports.length, pass: 0, fail: 0, "not-run": 0 };
  for (const r of reports) {
    summary.pass += r.summary.pass;
    summary.fail += r.summary.fail;
    summary["not-run"] += r.summary["not-run"];
  }
  return { reports, summary, ok: summary.fail === 0 };
}

export { targetProblems };
