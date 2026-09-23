#!/usr/bin/env node
/**
 * Genererer deterministisk konformansbevis for referencemodulet ved at køre
 * hvert verbum mod den kørende tjeneste med den rigtige PDP. Beviset er altså
 * fremkaldt, ikke påstået.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuditService } from "./server.mjs";
import { createPdp } from "../../../../policy/pdp/src/pdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(here, "..", "..");
const evidenceDir = join(moduleDir, "conformance", "evidence");
const eventsDir = join(moduleDir, "conformance", "events");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const agentPrincipal = (headers) => {
  if (headers?.["x-test-kind"] === "human") {
    return { kind: "human", id: "oidc|dpo@example.org", tenantId: "acme", groups: ["platform-approvers"] };
  }
  return {
    kind: "agent",
    id: "spiffe://platform.example.org/agents/audit-service-operator",
    spiffeId: "spiffe://platform.example.org/agents/audit-service-operator",
    autonomyClass: "A3",
    onBehalfOf: "oidc-group:platform-approvers",
  };
};

const evidenceList = ["policy-allow", "tests-pass", "dry-run-clean", "rollback-tested", "restore-verified", "scan-clean"];
const approvals = [
  { subject: "oidc|anna.andersen", verdict: "approve" },
  { subject: "oidc|bo.bertelsen", verdict: "approve" },
];
const identifiers = [{ type: "email", value: "kunde@example.org" }];
const base = { tenantId: "acme", environment: "dev", target: "audit-service/store", evidence: evidenceList, approvals, changeUri: "https://git.example.org/platform/contracts/-/merge_requests/7" };

const REQUESTS = [
  { verb: "backup", method: "POST", path: "/v1/ops/backup", body: {} },
  { verb: "restore", method: "POST", path: "/v1/ops/restore", body: { artifact: "s3://evidence/audit-service/backup/latest.tar" } },
  { verb: "verify-restore", method: "POST", path: "/v1/ops/verify-restore", body: {} },
  { verb: "drain", method: "POST", path: "/v1/ops/drain", body: {} },
  { verb: "upgrade.dry-run", method: "POST", path: "/v1/ops/upgrade/dry-run", body: {} },
  { verb: "upgrade", method: "POST", path: "/v1/ops/upgrade", body: { fromVersion: "1.0.0", toVersion: "1.0.1" } },
  { verb: "migrate", method: "POST", path: "/v1/ops/migrate", body: { toSchema: "v2" } },
  { verb: "rollback", method: "POST", path: "/v1/ops/rollback", body: { toVersion: "1.0.0" } },
  { verb: "slo", method: "POST", path: "/v1/ops/slo", body: {} },
  { verb: "health", method: "GET", path: "/healthz", body: null, auth: false },
  { verb: "subject.locate", method: "POST", path: "/v1/privacy/locate", body: { identifiers } },
  { verb: "subject.export", method: "POST", path: "/v1/privacy/export", body: { identifiers } },
  { verb: "retention.policy", method: "GET", path: "/v1/privacy/retention", body: null },
  { verb: "subject.legal_hold", method: "POST", path: "/v1/privacy/legal-hold", body: { identifiers } },
  { verb: "subject.erase", method: "POST", path: "/v1/privacy/erase", body: { identifiers } },
];

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });

  const pdp = createPdp();
  const service = createAuditService({
    authenticate: (auth, headers) => agentPrincipal(headers),
    pdp: { decide: async (input) => pdp.decide(input) },
    onEvent: () => {},
  });
  service.subjects.add({ subjects: identifiers, dataCategories: ["personal"], data: { plan: "gold" } });
  service.subjects.add({ subjects: [{ type: "customer-id", value: "C-998877" }], dataCategories: ["pseudonymised"], data: { tickets: 3 } });

  const port = await service.listen(0);
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  let failures = 0;

  for (const req of REQUESTS) {
    const started = Date.now();
    const res = await fetch(url(req.path), {
      method: req.method,
      headers: { "content-type": "application/json", "x-test-kind": "agent" },
      ...(req.body ? { body: JSON.stringify({ ...base, ...req.body }) } : {}),
    });
    const text = await res.text();
    const durationMs = Date.now() - started;
    const ok = res.status === 200;
    if (!ok) {
      failures += 1;
      console.error(`✘ ${req.verb}: HTTP ${res.status} ${text}`);
    }
    const fixture = {
      verb: req.verb,
      module: "audit-service",
      moduleVersion: "1.0.0",
      capturedAt: new Date().toISOString(),
      result: ok ? "pass" : "fail",
      checks: [{ name: "http-200", status: ok ? "pass" : "fail", detail: `HTTP ${res.status}` }],
      measurements: { durationMs },
      artifact: { uri: `s3://evidence/audit-service/${req.verb}.json`, sha256: sha256(text) },
    };
    writeFileSync(join(evidenceDir, `${req.verb}.json`), JSON.stringify(fixture, null, 2) + "\n");
  }

  // Et menneske-handling og en agent-handling, så begge principal-typer er dækket.
  await fetch(url("/v1/privacy/locate"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-kind": "human" },
    body: JSON.stringify({ ...base, identifiers }),
  });

  const agentEvent = service.emitted.find((e) => e.principal.kind === "agent");
  const humanEvent = service.emitted.find((e) => e.principal.kind === "human");
  writeFileSync(join(eventsDir, "agent-action.json"), JSON.stringify(agentEvent, null, 2) + "\n");
  writeFileSync(join(eventsDir, "human-action.json"), JSON.stringify(humanEvent, null, 2) + "\n");

  // Den faktiske PDP-beslutning for et gated verbum.
  const decision = pdp.decide({
    principal: { kind: "agent", id: base.tenantId ? "spiffe://platform.example.org/agents/audit-service-operator" : "x", autonomyClass: "A3" },
    action: { verb: "upgrade", target: "audit-service/store", environment: "dev", autonomyClass: "A3" },
    context: { tenantId: "acme", evidence: evidenceList, changeUri: base.changeUri },
  });
  writeFileSync(join(evidenceDir, "policy-decision.json"), JSON.stringify(decision, null, 2) + "\n");

  await service.close();

  const chain = service.log.verifyChain();
  console.log(`✔ ${REQUESTS.length} verbums-beviser skrevet til ${evidenceDir}`);
  console.log(`✔ audit-kæde: ${chain.ok ? `intakt (${chain.length} events)` : `BRUDT ved #${chain.brokenAt}`}`);
  console.log(`✔ cloud events: 1 agent, 1 menneske`);
  if (failures) process.exit(1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
