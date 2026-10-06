#!/usr/bin/env node
/**
 * 0.5: DSAR-orkestrator. Ét kald fan-out'es til alle moduler, og resultatet
 * samles med per-modul status. Offline bruges modulets deklarerede conformance
 * som svar, så dummies kan demonstrere flowet uden upstream-integration.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS, repoRoot } from "./schemas.mjs";
import { loadModule, resolveModuleDir } from "./manifest.mjs";

const PRIVACY_VERBS = new Set([
  "subject.locate",
  "subject.export",
  "subject.erase",
  "subject.legal_hold",
  "retention.policy",
]);

export async function orchestrate(request, modules, { offline = true, fetchImpl = globalThis.fetch, endpoints = null, headers = null, timeoutMs = 10_000 } = {}) {
  const targets = request.targets?.length ? new Set(request.targets) : null;
  const results = [];

  for (const { dir, manifest } of modules) {
    const name = manifest.metadata?.name ?? dir;
    if (targets && !targets.has(name)) continue;

    const block = manifest.privacy?.[request.verb];
    if (!block) {
      results.push({ module: name, moduleVersion: manifest.metadata?.version, verb: request.verb, status: "failed", error: "verbet er ikke deklareret i modulet" });
      continue;
    }

    const endpoint = endpoints?.[name] ?? manifest.privacy?.dsarEndpoint;
    if (!offline && endpoint) {
      const started = Date.now();
      const requestHeaders = typeof headers === "function" ? headers(name) : headers ?? {};
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...requestHeaders },
          body: JSON.stringify(request),
          signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${payload?.error ?? "ukendt"}`), { httpStatus: res.status });
        // Adaptere svarer med en kuvert `{ verb, decision, result, traceId }`.
        // Normalisér den til DSAR-svarets per-modul form, så status og poster
        // ikke forsvinder i en aggregat-fejl.
        const inner = payload.result ?? payload;
        const declared = block.conformance;
        const status = payload.status ?? inner.status ?? (declared === "full" ? (request.verb === "subject.locate" ? "found" : "full") : declared);
        const records = Array.isArray(inner.records) ? inner.records : Array.isArray(payload.records) ? payload.records : null;
        const recordsAffected = inner.count ?? inner.recordsAffected ?? payload.recordsAffected ?? (records ? records.length : undefined);
        const reason = payload.reason ?? inner.reason ?? (status === "partial" || status === "unsupported" ? block.reason : undefined);
        const artifactRef = inner.artifactRef ?? payload.artifactRef;
        results.push({
          module: name,
          moduleVersion: manifest.metadata?.version,
          verb: request.verb,
          durationMs: Date.now() - started,
          status,
          ...(recordsAffected !== undefined ? { recordsAffected } : {}),
          ...(records ? { records } : {}),
          ...(reason ? { reason } : {}),
          ...(artifactRef ? { artifactRef } : {}),
        });
      } catch (err) {
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        const unreachable = !err?.httpStatus;
        results.push({
          module: name,
          moduleVersion: manifest.metadata?.version,
          verb: request.verb,
          durationMs: Date.now() - started,
          // En timeout eller netværksfejl må aldrig blive et falsk fuldt svar.
          status: timedOut ? "failed" : unreachable ? "unknown" : "failed",
          error: timedOut ? `timeout efter ${timeoutMs} ms` : err.message,
        });
      }
      continue;
    }

    results.push(synthesise(name, manifest, request.verb, block));
  }

  const summary = {
    modulesQueried: results.length,
    full: results.filter((r) => r.status === "full").length,
    found: results.filter((r) => r.status === "found").length,
    partial: results.filter((r) => r.status === "partial").length,
    unsupported: results.filter((r) => r.status === "unsupported").length,
    failed: results.filter((r) => r.status === "failed").length,
    unknown: results.filter((r) => r.status === "unknown").length,
  };
  const degraded = summary.failed > 0 || summary.unknown > 0 || summary.partial > 0 || summary.unsupported > 0;
  const status = degraded ? "partially-completed" : "completed";

  return {
    requestId: request.requestId,
    verb: request.verb,
    completedAt: new Date().toISOString(),
    status,
    results,
    summary,
  };
}

function synthesise(name, manifest, verb, block) {
  const base = { module: name, moduleVersion: manifest.metadata?.version, verb, durationMs: 0 };
  switch (block.conformance) {
    case "full":
      // `subject.locate` bruger `found`, fordi spørgsmålet er om subjektet blev
      // fundet — ikke om en efterfølgende handling blev fuldført.
      return verb === "subject.locate" ? { ...base, status: "found", recordsAffected: 0 } : { ...base, status: "full", recordsAffected: 0 };
    case "partial":
      return { ...base, status: "partial", recordsAffected: 0, reason: block.reason };
    case "unsupported":
      return { ...base, status: "unsupported", reason: block.reason };
    default:
      return { ...base, status: "failed", error: `ukendt conformance '${block.conformance}'` };
  }
}

export function loadAllModules() {
  const modulesDir = join(repoRoot, "modules");
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((d) => existsSync(join(modulesDir, d, "module-manifest.json")))
    .map((d) => loadModule(resolveModuleDir(repoRoot, d)));
}

export function buildRequest({ verb, tenantId, identifiers, targets, legalBasis = "gdpr-art-15", requestedBy = "cli" }) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "PrivacySubjectRequest",
    requestId: randomUUID(),
    createdAt: new Date().toISOString(),
    tenantId,
    verb,
    subject: { identifiers },
    legalBasis: { type: legalBasis },
    requestedBy: { kind: "human", id: requestedBy },
    targets,
  };
}

function parseIdentifiers(specs) {
  return specs.map((s) => {
    const idx = s.indexOf("=");
    if (idx < 0) throw new Error(`--identifier skal være type=værdi, fik '${s}'`);
    return { type: s.slice(0, idx), value: s.slice(idx + 1) };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { identifiers: [], targets: [], offline: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verb") opts.verb = argv[++i];
    else if (a === "--tenant") opts.tenantId = argv[++i];
    else if (a === "--identifier") opts.identifiers.push(argv[++i]);
    else if (a === "--module") opts.targets.push(argv[++i]);
    else if (a === "--legal-basis") opts.legalBasis = argv[++i];
    else if (a === "--online") opts.offline = false;
    else if (a === "--help" || a === "-h") {
      console.log("Brug: node src/dsar.mjs --verb subject.export --tenant acme --identifier email=a@b.dk [--module navn] [--online]");
      return;
    }
  }
  if (!opts.verb || !opts.tenantId || opts.identifiers.length === 0) {
    console.error("Kræver --verb, --tenant og mindst ét --identifier type=værdi");
    process.exit(2);
  }
  if (!PRIVACY_VERBS.has(opts.verb)) {
    console.error(`Ukendt privacy-verbum '${opts.verb}'. Gyldige: ${[...PRIVACY_VERBS].join(", ")}`);
    process.exit(2);
  }

  const modules = loadAllModules();
  if (modules.length === 0) {
    console.error("Ingen moduler fundet under /modules");
    process.exit(2);
  }

  const request = buildRequest({
    verb: opts.verb,
    tenantId: opts.tenantId,
    identifiers: parseIdentifiers(opts.identifiers),
    targets: opts.targets.length ? opts.targets : undefined,
    legalBasis: opts.legalBasis,
  });

  const response = await orchestrate(request, modules, { offline: opts.offline });
  const { ajv } = buildAjv();
  const { ok, errors } = validate(ajv, SCHEMA_IDS.privacyResponse, response);
  console.log(JSON.stringify({ request, response }, null, 2));
  if (!ok) {
    console.error("\n✘ Svaret matcher ikke privacy-response.schema.json:");
    for (const e of errors) console.error(`  ${(e.path || "/").trim()} ${e.message}`);
    process.exit(1);
  }
  console.log(
    `\n✔ ${response.status}: ${response.summary.full} full, ${response.summary.partial} partial, ` +
      `${response.summary.unsupported} unsupported, ${response.summary.failed} failed`
  );
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
