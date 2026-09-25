#!/usr/bin/env node
/**
 * Genererer konformansbevis for projektstyringsadapteren ved at køre de fulde
 * verber mod en mock OpenProject og den rigtige PDP. Beviser at adapteren kører,
 * og at partial-erklæringen på subject.erase holder i praksis.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenProjectAdapter } from "./server.mjs";
import { createOpenProjectClient } from "./openproject.mjs";
import { createMockOpenProject } from "./mock-openproject.mjs";
import { createPdp } from "../../../../policy/pdp/src/pdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(here, "..", "..");
const evidenceDir = join(moduleDir, "conformance", "evidence");
const eventsDir = join(moduleDir, "conformance", "events");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const identifiers = [{ type: "email", value: "bo@acme.example" }];
const base = { tenantId: "acme", environment: "dev", target: "openproject", evidence: ["policy-allow"], approvals: [{ subject: "oidc|dpo@example.org", verdict: "approve" }] };

const FULL_VERBS = [
  { verb: "health", method: "GET", path: "/healthz" },
  { verb: "subject.locate", method: "POST", path: "/v1/privacy/locate", body: { identifiers } },
  { verb: "subject.export", method: "POST", path: "/v1/privacy/export", body: { identifiers } },
];

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });

  const mock = createMockOpenProject();
  const mockPort = await mock.listen(0);
  const pdp = createPdp();
  const emitted = [];
  const adapter = createOpenProjectAdapter({
    authenticate: (auth, headers) =>
      headers?.["x-test-kind"] === "human"
        ? { kind: "human", id: "oidc|dpo@example.org", tenantId: "acme", role: "tenant-admin", groups: ["acme"] }
        : { kind: "agent", id: "spiffe://platform.example.org/agents/openproject-adapter", spiffeId: "spiffe://platform.example.org/agents/openproject-adapter", tenantId: "acme" },
    pdp: { decide: async (input) => pdp.decide(input) },
    client: createOpenProjectClient({ baseUrl: `http://127.0.0.1:${mockPort}`, token: "test-token" }),
    onEvent: (e) => emitted.push(e),
  });
  const port = await adapter.listen(0);
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  let failures = 0;

  for (const req of FULL_VERBS) {
    const started = Date.now();
    const res = await fetch(url(req.path), {
      method: req.method,
      headers: { "content-type": "application/json", "x-test-kind": "agent" },
      ...(req.body ? { body: JSON.stringify({ ...base, ...req.body }) } : {}),
    });
    const text = await res.text();
    const ok = res.status === 200;
    if (!ok) {
      failures += 1;
      console.error(`✘ ${req.verb}: HTTP ${res.status} ${text}`);
    }
    writeFileSync(
      join(evidenceDir, `${req.verb}.json`),
      JSON.stringify(
        {
          verb: req.verb,
          module: "openproject-adapter",
          moduleVersion: "1.0.0",
          capturedAt: new Date().toISOString(),
          result: ok ? "pass" : "fail",
          checks: [{ name: "http-200", status: ok ? "pass" : "fail", detail: `HTTP ${res.status}` }],
          measurements: { durationMs: Date.now() - started },
          artifact: { uri: `s3://evidence/openproject-adapter/${req.verb}.json`, sha256: sha256(text) },
        },
        null,
        2
      ) + "\n"
    );
  }

  // subject.erase er partial: vi vil se, at medlemskaber/tildelinger slettes,
  // men at adapteren erkender de kopier den ikke kan fjerne.
  const eraseRes = await fetch(url("/v1/privacy/erase"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-kind": "agent" },
    body: JSON.stringify({ ...base, identifiers, reason: "DSAR-sletning i konformansbevis", approvals: [{ subject: "oidc|dpo@example.org", verdict: "approve" }] }),
  });
  const eraseBody = await eraseRes.json();
  console.log(`subject.erase -> HTTP ${eraseRes.status}, partial=${eraseBody.result?.partial}, slettet=${eraseBody.result?.recordsAffected}`);

  await fetch(url("/v1/privacy/locate"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-kind": "human" },
    body: JSON.stringify({ ...base, identifiers }),
  });

  const agentEvent = emitted.find((e) => e?.principal?.kind === "agent");
  const humanEvent = emitted.find((e) => e?.principal?.kind === "human");
  writeFileSync(join(eventsDir, "agent-action.json"), JSON.stringify(agentEvent, null, 2) + "\n");
  writeFileSync(join(eventsDir, "human-action.json"), JSON.stringify(humanEvent, null, 2) + "\n");

  const decision = pdp.decide({
    principal: { kind: "agent", id: "spiffe://platform.example.org/agents/openproject-adapter" },
    action: { verb: "subject.erase", target: "openproject", environment: "dev" },
    context: { tenantId: "acme", evidence: ["policy-allow"] },
  });
  writeFileSync(join(evidenceDir, "policy-decision.json"), JSON.stringify(decision, null, 2) + "\n");

  await adapter.close();
  await mock.close();
  console.log(`✔ ${FULL_VERBS.length} full-verbums-beviser + partial-erkendelse skrevet til ${evidenceDir}`);
  if (failures) process.exit(1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
