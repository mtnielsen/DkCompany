#!/usr/bin/env node
/**
 * DKC-044 — CLI for ITSM-adapteren.
 *
 *   node src/cli.mjs serve [--port 8092 ...]   # kør adapteren mod en GLPI
 *   node src/cli.mjs demo                      # kør et kontrolleret ITSM-forløb mod mock
 *
 * `serve` kræver en rigtig GLPI (NOT RUN i dette miljø). `demo` beviser
 * domæneadfærden deterministisk mod mock-upstream og en lokal allow-PDP.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createItsmAdapter } from "./server.mjs";
import { createGlpiClient } from "./itsm.mjs";
import { createMockItsm } from "./mock-itsm.mjs";
import { createItsmService } from "./serviceregistry.mjs";
import { createPdpClient } from "./pdp-client.mjs";
import { createSpiffeAuthenticator, createAuthenticator } from "./auth.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const load = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));

function parseArgs(argv) {
  const args = { command: argv[0] ?? "serve", port: 8092, pdp: "http://127.0.0.1:8181/v1/data/platform/ops/decision", glpi: "http://glpi:80", appToken: "change-me", userToken: "change-me", trustDomain: "platform.example.org", environment: "dev", profile: "production", trustedProxies: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--pdp") args.pdp = argv[++i];
    else if (a === "--glpi") args.glpi = argv[++i];
    else if (a === "--app-token") args.appToken = argv[++i];
    else if (a === "--user-token") args.userToken = argv[++i];
    else if (a === "--trust-domain") args.trustDomain = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--trusted-proxy") args.trustedProxies.push(argv[++i]);
    else if (a === "--proxy-secret") args.proxySecret = argv[++i];
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

async function serve(args) {
  if (args.help) {
    console.log("Brug: node src/cli.mjs serve [--port 8092] [--glpi url] [--pdp url]");
    return;
  }
  const adapter = createItsmAdapter({
    authenticate: createAuthenticator([
      createSpiffeAuthenticator({ trustDomain: args.trustDomain, profile: args.profile, trustedProxies: args.trustedProxies, proxySecret: args.proxySecret }),
    ]),
    pdp: createPdpClient({ endpoint: args.pdp, failMode: "closed" }),
    client: createGlpiClient({ baseUrl: args.glpi, appToken: args.appToken, userToken: args.userToken }),
    catalog: load("service-registry/services.json"),
    rotations: load("service-registry/oncall.json"),
    environment: args.environment,
    profile: args.profile,
    onEvent: (e) => console.log(JSON.stringify(e)),
  });
  const port = await adapter.listen(args.port);
  console.log(`itsm-adapter lytter på http://127.0.0.1:${port}`);
  console.log(`  upstream: ${args.glpi} (GLPI, uændret)`);
  console.log(`  PDP: ${args.pdp} (fail-closed)`);
}

async function demo() {
  const mock = createMockItsm();
  const mockPort = await mock.listen(0);
  const client = createGlpiClient({ baseUrl: `http://127.0.0.1:${mockPort}`, appToken: "test-app-token", userToken: "test-user-token" });
  const catalog = load("service-registry/services.json");
  const rotations = load("service-registry/oncall.json");
  const service = createItsmService({ client, catalog, rotations });
  const observer = { kind: "agent", id: "spiffe://platform.example.org/agents/itsm-observer", name: "itsm-observer" };
  const maja = { kind: "human", id: "oidc|maja.mortensen", name: "Maja Mortensen", role: "Service Owner" };
  const bo = { kind: "human", id: "oidc|bo.bertelsen", name: "Bo Bertelsen", role: "On-call Engineer" };

  const ingested = await service.ingestAlarm({
    actor: observer,
    serviceId: "checkout",
    tenantId: "acme",
    alert: { id: "demo-alert", alertId: "demo-alert", ruleId: "checkout-availability", signal: "http_requests_total", severity: "critical", summary: "Checkout 5xx", emittedAt: new Date().toISOString() },
  });
  console.log(`alarm -> incident ${ingested.incident.id} (major=${ingested.incident.recordKind === "major_incident"}), ejer=${ingested.incident.owner.name}, berørte=${ingested.incident.affectedServices.join(",")}`);

  await service.acknowledgeIncident({ actor: bo, incidentId: ingested.incident.id, tenantId: "acme" });
  console.log("bo kvitterede for major incidenten");

  await service.closeIncident({ actor: observer, incidentId: ingested.incident.id, tenantId: "acme", healthcheck: "green", approvals: [{ kind: "human", verdict: "approve" }] }).then(
    () => console.log("FEJL: en AI lukkede en major incident"),
    (err) => console.log(`AI-lukning nægtet som forventet: ${err.code}`)
  );

  const change = await service.createChange({
    actor: maja,
    tenantId: "acme",
    change: { title: "Rul checkout tilbage", serviceId: "checkout", incidentIds: [ingested.incident.id], rollbackPlan: "Rul frem igen" },
    approvals: [{ id: "APR-1", subject: "oidc|anna.andersen", name: "Anna Andersen", verdict: "approve", kind: "human" }],
  });
  console.log(`change ${change.id} oprettet med runbook=${change.links.runbook}`);

  const repeated = [];
  for (let i = 0; i < 3; i++) {
    const r = await service.ingestAlarm({ actor: observer, serviceId: "checkout", tenantId: "acme", alert: { id: `rep-${i}`, alertId: `rep-${i}`, ruleId: "checkout-availability", signal: "http_requests_total", severity: "warning", summary: "Gentagen fejl", emittedAt: new Date().toISOString() } });
    repeated.push({ ...r.incident, id: `INC-REP-${i}`, state: "closed" });
  }
  const { problemCandidate } = await import("./serviceregistry.mjs");
  const proposals = problemCandidate({ incidents: repeated, threshold: 3 });
  if (proposals.length) {
    const { problem } = await service.createProblem({ actor: maja, tenantId: "acme", proposal: proposals[0] });
    console.log(`problem ${problem.id} og kendt fejl oprettet efter menneskelig validering`);
  } else {
    console.log("ingen problemforslag (for få gentagelser)");
  }

  const cases = await service.listCustomerCases({ actor: { ...maja, tenantId: "acme" }, tenantId: "acme" });
  console.log(`kunden ser ${cases.length} sag(er); ejerfelt skjult=${cases[0]?.owner === undefined}`);

  await mock.close();
  console.log("demo færdig (mock-upstream; en rigtig GLPI er NOT RUN)");
}

const args = parseArgs(process.argv.slice(2));
const run = args.command === "demo" ? demo : () => serve(args);
run().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
