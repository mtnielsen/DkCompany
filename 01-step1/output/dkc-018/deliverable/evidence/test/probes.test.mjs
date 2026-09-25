/**
 * DKC-018 — tests for integrations-/runtime-probe-køreren.
 *
 * Beviser at:
 *   - en probe mod et levende endpoint giver en forseglet evidenspost med mode,
 *     commit, image-digest, miljø, upstream-version, run-ID og udløb,
 *   - et ukendt endpoint bliver `not-run`, aldrig `pass`,
 *   - en negativ bypass-probe fejler, hvis det uautoriserede kald ikke afvises,
 *   - probe-manifestet afviser fixture-modes (kun integration/runtime beviser drift).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { recordDigest, PRODUCTION_MODES, validateEvidenceRecord } from "../../conformance/src/evidence-mode.mjs";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { runProbe, runProbes, probeManifestProblems } from "../src/probes.mjs";

const binding = { commit: "c".repeat(40), imageDigest: `sha256:${"3".repeat(64)}`, environment: "staging", upstreamVersion: "svc@1.0.0" };

let server;
let baseUrl;
let mode = "ok";

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/healthz" && mode === "ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", bundle: "platform@1.0.0" }));
      return;
    }
    if (req.url === "/direct" && mode === "deny") {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "direkte kald afvist" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("probe mod levende endpoint giver en gyldig runtime-/integration-post", async () => {
  mode = "ok";
  const probe = { id: "pdp-health", subject: { kind: "component", name: "pdp" }, mode: "integration", method: "GET", url: baseUrl, path: "/healthz", expectStatus: 200, expectJsonContains: "bundle" };
  const r = await runProbe(probe, { binding, runId: "run-42", now: Date.parse("2026-09-23T09:00:00Z") });
  assert.equal(r.result, "pass");
  assert.equal(r.mode, "integration");
  assert.equal(r.commit, binding.commit);
  assert.equal(r.imageDigest, binding.imageDigest);
  assert.equal(r.environment, "staging");
  assert.equal(r.runId, "run-42");
  assert.ok(r.expiresAt > r.capturedAt);
  assert.equal(r.digest, recordDigest(r));
  // artifact.sha256 er en rigtig digest over den observerede hændelse, ikke en pladsholder.
  assert.match(r.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(r.artifact.sha256, "0".repeat(64));
  // ... og posten validerer fuldt mod kontrakten.
  const schema = validateEvidenceRecord(r, buildAjv().ajv, { now: Date.parse("2026-09-23T09:00:00Z") });
  assert.equal(schema.ok, true, JSON.stringify(schema.errors, null, 2));
});

test("ukendt endpoint bliver not-run, aldrig pass", async () => {
  const probe = { id: "missing", subject: { kind: "component", name: "pdp" }, mode: "integration", url: "http://127.0.0.1:1", path: "/healthz", expectStatus: 200 };
  const r = await runProbe(probe, { binding, runId: "run-42" });
  assert.equal(r.result, "not-run");
  assert.match(r.notes, /kunne ikke nås/);
});

test("manglende konfiguration bliver not-run", async () => {
  const probe = { id: "unset", subject: { kind: "component", name: "pdp" }, mode: "integration", urlEnv: "DKC_PROBE_MISSING_URL", path: "/healthz", expectStatus: 200 };
  const r = await runProbe(probe, { binding, runId: "run-42", env: {} });
  assert.equal(r.result, "not-run");
  assert.match(r.notes, /ikke konfigureret/);
});

test("negativ bypass-probe fejler når det direkte kald ikke afvises", async () => {
  mode = "deny";
  const denyProbe = { id: "direct-deny", subject: { kind: "component", name: "runtime" }, mode: "integration", method: "POST", url: baseUrl, path: "/direct", expectDeny: true };
  const denied = await runProbe(denyProbe, { binding, runId: "run-42" });
  assert.equal(denied.result, "pass", "403 skal give pass for en deny-probe");

  mode = "ok";
  const allowed = await runProbe(denyProbe, { binding, runId: "run-42" });
  assert.equal(allowed.result, "fail");
  assert.match(allowed.notes, /direkte kald blev ikke afvist/);
});

test("runProbes opsummerer og fejler på fail", async () => {
  mode = "ok";
  const manifest = {
    ttlDays: 7,
    probes: [
      { id: "ok", subject: { kind: "component", name: "pdp" }, mode: "integration", url: baseUrl, path: "/healthz", expectStatus: 200 },
      { id: "bad-status", subject: { kind: "component", name: "pdp" }, mode: "integration", url: baseUrl, path: "/healthz", expectStatus: 201 },
    ],
  };
  const result = await runProbes({ manifest, binding, runId: "run-42" });
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.pass, 1);
  assert.equal(result.summary.fail, 1);
  assert.equal(result.ok, false);
});

test("probemanifestet afviser fixture-modes", () => {
  const problems = probeManifestProblems({ probes: [{ id: "x", mode: "fixture", url: "http://x", expectStatus: 200 }] });
  assert.ok(problems.some((p) => /integration\/runtime/.test(p)));
  assert.deepEqual(probeManifestProblems({ probes: [{ id: "ok", mode: "runtime", url: "http://x", expectStatus: 200 }] }), []);
  assert.ok(PRODUCTION_MODES.includes("runtime"));
});
