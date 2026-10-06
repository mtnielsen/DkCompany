import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { contractsDir, repoRoot, buildAjv, validate, SCHEMA_IDS } from "../src/schemas.mjs";
import { validatePrivacyExportDir } from "../src/privacy.mjs";
import { orchestrate, buildRequest } from "../src/dsar.mjs";

const examplesDir = join(contractsDir, "examples");

const stubbedModule = (name) => ({
  dir: name,
  manifest: {
    metadata: { name, version: "1.0.0" },
    privacy: { dsarEndpoint: `http://${name}.test/v1/privacy`, "subject.export": { conformance: "full" } },
  },
});

test("den committede eksport validerer (skema + udløbs-/modtager-/digest-semantik)", () => {
  const results = validatePrivacyExportDir(examplesDir);
  assert.ok(results.length >= 1);
  for (const r of results) assert.equal(r.ok, true, `${r.file}: ${r.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
});

test("en timeout giver failed og en uopnåelig app giver unknown — aldrig full", async () => {
  const request = buildRequest({ verb: "subject.export", tenantId: "acme", identifiers: [{ type: "email", value: "kunde@example.org" }] });
  const endpoints = { slow: "http://slow.test/v1/privacy", down: "http://down.test/v1/privacy" };
  const slow = () => new Promise((_, reject) => {
    const err = new Error("aborted");
    err.name = "TimeoutError";
    setTimeout(() => reject(err), 5);
  });
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  const base = { "content-type": "application/json" };

  const slowResponse = await orchestrate(request, [stubbedModule("slow")], { offline: false, endpoints, fetchImpl: slow, timeoutMs: 20 });
  assert.equal(slowResponse.results[0].status, "failed");
  assert.equal(slowResponse.summary.failed, 1);
  assert.equal(slowResponse.status, "partially-completed");

  const downResponse = await orchestrate(request, [stubbedModule("down")], { offline: false, endpoints, headers: base, fetchImpl: down });
  assert.equal(downResponse.results[0].status, "unknown");
  assert.equal(downResponse.summary.unknown, 1);
  assert.equal(downResponse.status, "partially-completed");

  const { ajv } = buildAjv();
  for (const response of [slowResponse, downResponse]) {
    const { ok, errors } = validate(ajv, SCHEMA_IDS.privacyResponse, response);
    assert.equal(ok, true, JSON.stringify(errors, null, 2));
  }
});

test("et online svar med fundne poster giver found-status og bevarer posterne", async () => {
  const request = buildRequest({ verb: "subject.locate", tenantId: "acme", identifiers: [{ type: "email", value: "kunde@example.org" }] });
  const module = {
    dir: "app",
    manifest: { metadata: { name: "app", version: "1.0.0" }, privacy: { dsarEndpoint: "http://app.test/v1/privacy", "subject.locate": { conformance: "full" } } },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ verb: "subject.locate", decision: "allow", result: { count: 2, matches: [{ subjectId: "u1" }] } }) });
  const response = await orchestrate(request, [module], { offline: false, endpoints: { app: "http://app.test/v1/privacy/locate" }, fetchImpl });
  assert.equal(response.results[0].status, "found");
  assert.equal(response.results[0].recordsAffected, 2);
  assert.equal(response.summary.found, 1);
  const { ajv } = buildAjv();
  const { ok, errors } = validate(ajv, SCHEMA_IDS.privacyResponse, response);
  assert.equal(ok, true, JSON.stringify(errors, null, 2));
  assert.ok(repoRoot.length > 0);
});
