#!/usr/bin/env node
/**
 * DKC-066 — CLI for telemetri-API'et.
 *
 *   node telemetry-api/src/cli.mjs check      # validér collectorkatalog + kontrakteksempler
 *   node telemetry-api/src/cli.mjs demo       # kør et kontrolleret staging-fejlforløb offline
 *   node telemetry-api/src/cli.mjs serve      # start HTTP-API'et (kræver DKC_TELEMETRY_JWKS)
 *
 * `demo` indtager en kontrolleret staging-fejl, bygger de fem views, viser
 * korrelationen (version → trace → alarm → incident) og renderer gennem to
 * udskiftelige dashboard-adaptere. Den bruger ingen levende backend.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateTelemetryEnvelope, validateDashboardView, validateDashboardAdapter, validateCollectorStatus, validateTestRun, validateRecoveryStatus } from "../../conformance/src/telemetry-api.mjs";
import { loadCollectorRegistry, collectorRegistryProblems, envelopeProblems } from "./envelope.mjs";
import { createBoundedStore } from "./store.mjs";
import { createIngestor } from "./ingest.mjs";
import { createQueryService } from "./query.mjs";
import { createGrafanaAdapter, createLokiAdapter, createAdapterRegistry } from "./adapters.mjs";
import { collectorStatus } from "./collectors.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

function loadExample(name) {
  const path = join(repoRoot, "contracts", "examples", name);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runCheck() {
  const problems = [];
  const { ajv } = buildAjv();
  const registry = loadCollectorRegistry(repoRoot);
  for (const p of collectorRegistryProblems(registry)) problems.push(`telemetry-api/collectors.json${p}`);
  const now = Date.parse("2025-09-01T10:01:00Z");
  const checks = [
    ["telemetry-envelope.example.json", (d) => validateTelemetryEnvelope(d, ajv, { now, registry })],
    ["dashboard-view.example.json", (d) => validateDashboardView(d, ajv)],
    ["dashboard-adapter.example.json", (d) => validateDashboardAdapter(d, ajv)],
    ["collector-status.example.json", (d) => validateCollectorStatus(d, ajv)],
    ["test-run.example.json", (d) => validateTestRun(d, ajv)],
    ["recovery-status.example.json", (d) => validateRecoveryStatus(d, ajv)],
  ];
  for (const [name, validator] of checks) {
    let data;
    try {
      data = loadExample(name);
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
      continue;
    }
    const result = validator(data);
    for (const e of result.errors) problems.push(`${name}${e.path}: ${e.message}`);
  }
  const envelopeResult = envelopeProblems(loadExample("telemetry-envelope.example.json"), { now, registry });
  for (const p of envelopeResult.problems) problems.push(`telemetry-envelope.example.json${p.path}: ${p.message}`);
  return { problems, registry };
}

const TENANT = "acme";
const principal = { id: "oidc|acme-operator", tenantId: TENANT, roles: ["operator", "platform-admin"], viewScope: ["view:operations", "view:vulnerabilities", "view:test-release", "view:recovery", "view:ai"], environment: "staging" };
const TRACE = "0123456789abcdef0123456789abcdef";

function envelope(overrides) {
  return {
    schemaVersion: "1.0",
    kind: "TelemetryEnvelope",
    id: overrides.id,
    occurredAt: overrides.occurredAt ?? new Date(Date.now()).toISOString(),
    signal: overrides.signal ?? "metric",
    source: { id: "otel-collector", kind: "otel", version: "0.110.0" },
    scope: { tenantId: TENANT, environment: "staging", service: "dummy-ok" },
    resource: `res://${TENANT}/service/dummy-ok`,
    relations: {
      environment: "res://platform/environment/staging",
      version: `res://${TENANT}/version/1.4.2`,
      trace: `res://${TENANT}/trace/${TRACE}`,
    },
    dataClassification: "operational",
    ...overrides,
  };
}

export async function runDemo({ now = Date.now() } = {}) {
  const registry = loadCollectorRegistry(repoRoot);
  const store = createBoundedStore({ capacity: 1000, retentionSeconds: 86400, clock: () => now });
  const ingestor = createIngestor({ store, registry, clock: () => now });
  const query = createQueryService({ store, clock: () => now });
  const adapters = createAdapterRegistry([createGrafanaAdapter({ query }), createLokiAdapter({ query })]);

  const at = (offset) => new Date(now + offset).toISOString();
  const events = [
    envelope({ id: "staging-metric-req", occurredAt: at(-60000), otel: { metric: { name: "http_requests_total", value: 1200, unit: "1" } }, labels: { status: "200" } }),
    envelope({ id: "staging-metric-err", occurredAt: at(-30000), otel: { metric: { name: "http_errors_total", value: 90, unit: "1" } }, labels: { status: "500" } }),
    envelope({
      id: "staging-error",
      occurredAt: at(-20000),
      signal: "finding",
      source: { id: "trivy-ci", kind: "scanner" },
      resource: `res://${TENANT}/finding/CVE-2025-066`,
      relations: { environment: "res://platform/environment/staging", version: `res://${TENANT}/version/1.4.2`, trace: `res://${TENANT}/trace/${TRACE}`, incident: `res://${TENANT}/incident/INC-066`, alert: `res://${TENANT}/alert/ALT-066` },
      ref: { contract: "security-findings", id: "staging-error", uri: "security/raw/trivy-app.json", digest: "a".repeat(64) },
      payload: { cve: "CVE-2025-066", severity: "critical", title: "staging-fejl", owner: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Security Owner" }, status: "open", remediation: "opgrader" },
    }),
  ];
  const results = events.map((e) => ingestor.ingest({ principal, envelope: e }));
  const correlation = results.find((r) => r.id === "staging-error")?.correlation ?? results.find((r) => r.correlation)?.correlation ?? null;

  const views = {
    operations: query.readView({ principal, view: "operations", now }),
    vulnerabilities: query.readView({ principal, view: "vulnerabilities", now }),
  };
  const rendered = await adapters.render({ adapterId: "grafana", principal, view: "operations", now });
  const status = collectorStatus({ registry, observations: Object.fromEntries(registry.sources.map((s) => [s.id, { lastSeenAt: new Date(now).toISOString() }])), now });
  return { results, correlation, views, rendered, collectors: status, ingestor: ingestor.stats() };
}

async function main() {
  const command = process.argv[2] ?? "check";
  if (command === "check") {
    const { problems, registry } = runCheck();
    if (problems.length) {
      console.error("✘ DKC-066-kontrol fejlede:\n");
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✔ Collectorkatalog valid: ${registry.sources.length} kilder`);
    console.log("✔ 6 DKC-066-eksempler valideret (envelope, view, adapter, collector, testkørsel, recovery)");
    return;
  }
  if (command === "demo") {
    const demo = await runDemo();
    console.log("Kontrolleret staging-fejl:");
    for (const r of demo.results) console.log(`  ${r.accepted ? "✔" : "✘"} ${r.id}: ${r.status}${r.reason ? ` — ${r.reason}` : ""}`);
    console.log(`Korrelation: ${demo.correlation.edges.map((e) => `${e.relation} → ${e.to}`).join(", ")}`);
    for (const [name, view] of Object.entries(demo.views)) console.log(`View ${name}: status=${view.status}, lastObservedAt=${view.lastObservedAt}`);
    console.log(`Grafana-adapter: status=${demo.rendered.status}, paneler=${demo.rendered.data.panels.length}`);
    console.log(`Collectorer: overall=${demo.collectors.overall}`);
    return;
  }
  if (command === "serve") {
    const { createTelemetryServer, createJwsAuthenticator } = await import("./server.mjs");
    const jwksPath = process.env.DKC_TELEMETRY_JWKS;
    if (!jwksPath || !existsSync(jwksPath)) {
      console.error("✘ NOT RUN: sæt DKC_TELEMETRY_JWKS til et JWKS for at starte API'et.");
      process.exit(2);
    }
    const jwks = JSON.parse(readFileSync(jwksPath, "utf8"));
    const registry = loadCollectorRegistry(repoRoot);
    const store = createBoundedStore({ capacity: registry.bounds.maxBuffer, retentionSeconds: 86400, maxCardinality: registry.bounds.maxCardinality });
    const ingestor = createIngestor({ store, registry });
    const query = createQueryService({ store });
    const adapters = createAdapterRegistry([createGrafanaAdapter({ query }), createLokiAdapter({ query })]);
    const server = createTelemetryServer({ ingestor, query, registry, adapters, authenticator: createJwsAuthenticator({ jwks }) });
    const port = await server.listen(Number(process.env.DKC_TELEMETRY_PORT ?? 4319));
    console.log(`telemetri-API lytter på http://127.0.0.1:${port}`);
    return;
  }
  console.error(`Ukendt kommando: ${command}`);
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  });
}
