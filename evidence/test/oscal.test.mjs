import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { uuidFor, findingFromCheck, buildAssessmentResults, OSCAL_VERSION } from "../src/oscal.mjs";
import { collect, repoRoot } from "../src/collect.mjs";

test("uuidFor er deterministisk og har gyldig UUID-form", () => {
  const a = uuidFor("modul:demo");
  assert.equal(a, uuidFor("modul:demo"));
  assert.notEqual(a, uuidFor("modul:anden"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("findingFromCheck mapper pass til satisfied og alt andet til not-satisfied", () => {
  const pass = findingFromCheck({
    prefix: "p",
    check: { id: "C-001", title: "manifest", status: "pass", detail: "ok", messages: [] },
  });
  assert.equal(pass.target.status.state, "satisfied");
  assert.equal(pass.target["target-id"], "C-001");

  const fail = findingFromCheck({
    prefix: "p",
    check: { id: "C-004", title: "bevis", status: "fail", detail: "mangler", messages: ["health: fixture mangler", "restore: ugyldig"] },
  });
  assert.equal(fail.target.status.state, "not-satisfied");
  assert.match(fail.target.status.reason, /health: fixture mangler; restore: ugyldig/);

  const skip = findingFromCheck({
    prefix: "p",
    check: { id: "C-007", title: "events", status: "skip", detail: "ingen events", messages: [] },
  });
  assert.equal(skip.target.status.state, "not-satisfied", "skip må ikke pyntes til satisfied");
});

function syntheticArtifacts() {
  return {
    generatedAt: "2025-09-01T12:00:00Z",
    modules: [
      {
        name: "demo",
        version: "1.0.0",
        manifest: { compliance: { controlRefs: ["ac-2", "au-2"] } },
        report: {
          startedAt: "2025-09-01T11:59:00Z",
          finishedAt: "2025-09-01T12:00:00Z",
          checks: [
            { id: "C-001", title: "manifest", status: "pass", detail: "ok", messages: [] },
            { id: "C-004", title: "bevis", status: "fail", detail: "mangler", messages: ["health: fixture mangler"] },
          ],
        },
        evidence: [
          {
            verb: "health",
            ref: "modules/demo/conformance/evidence/health.json",
            data: { result: "pass", capturedAt: "2025-09-01T12:00:05Z" },
          },
        ],
        events: [
          {
            ref: "modules/demo/conformance/events/agent-action.json",
            data: {
              type: "dk.platform.demo.done",
              source: "urn:platform:module:demo",
              time: "2025-09-01T12:00:06Z",
              principal: { kind: "agent", id: "spiffe://platform.example.org/agents/demo" },
            },
          },
        ],
        decision: {
          ref: "modules/demo/conformance/evidence/policy-decision.json",
          data: {
            decision: "allow",
            pdp: { name: "platform-pdp", version: "1.0.0", bundleName: "platform", bundleVersion: "1.0.0" },
            evaluatedAt: "2025-09-01T12:00:07Z",
          },
        },
      },
    ],
    gitops: {
      status: "pass",
      checks: [{ id: "G-001", title: "GitOps-styret", status: "pass", detail: "ok", messages: [] }],
      summary: { pass: 1, fail: 0, total: 1 },
    },
    changelog: [
      { hash: "a", signedOff: true },
      { hash: "b", signedOff: false },
    ],
  };
}

test("buildAssessmentResults giver et skemagyldigt dokument og ærlige findings", () => {
  const doc = buildAssessmentResults(syntheticArtifacts());
  const { ajv } = buildAjv();
  const { ok, errors } = validate(ajv, SCHEMA_IDS.oscalAssessmentResults, doc);
  assert.equal(ok, true, errors.map((e) => `${e.path} ${e.message}`).join("\n"));

  assert.equal(doc["assessment-results"].metadata["oscal-version"], OSCAL_VERSION);
  const results = doc["assessment-results"].results;
  assert.equal(results.length, 2, "ét modulresultat + change control");

  // Link mellem finding og observation for C-004.
  const demo = results.find((r) => r.title.startsWith("demo"));
  const c004 = demo.findings.find((f) => f.target["target-id"] === "C-004");
  assert.equal(c004.target.status.state, "not-satisfied");
  assert.equal(c004["related-observations"].length, 1);
  assert.equal(demo.observations.length, 3, "1 verbum, 1 PDP-beslutning, 1 hændelse");
  assert.deepEqual(demo["reviewed-controls"]["control-selections"][0]["include-controls"], [
    { "control-id": "ac-2" },
    { "control-id": "au-2" },
  ]);

  // DCO-fundet skal være not-satisfied, fordi én commit mangler sign-off.
  const change = results.find((r) => r.title.startsWith("GitOps"));
  const dco = change.findings.find((f) => f.target["target-id"] === "DCO");
  assert.equal(dco.target.status.state, "not-satisfied");
  assert.match(dco.target.status.reason, /1 commits uden/);
});

test("integration: emitteren bygger en gyldig pakke fra repoets artefakter", (t) => {
  if (!existsSync(join(repoRoot, ".conformance-out/report.json"))) {
    t.skip("kræver 'make conform-all' først");
    return;
  }
  const doc = buildAssessmentResults(collect({ generatedAt: "2025-09-01T12:00:00Z" }));
  const { ajv } = buildAjv();
  const { ok, errors } = validate(ajv, SCHEMA_IDS.oscalAssessmentResults, doc);
  assert.equal(ok, true, errors.map((e) => `${e.path} ${e.message}`).join("\n"));

  const results = doc["assessment-results"].results;
  assert.ok(results.length >= 4, "mindst tre moduler + change control");
  for (const result of results) {
    assert.ok(result.findings.length > 0, `${result.title} mangler findings`);
    assert.ok(result["reviewed-controls"]["control-selections"].length > 0);
  }
  assert.ok(results.some((r) => r.observations.length > 0), "mindst ét resultat skal have observationer");
  // Ingen finding må være 'satisfied' uden en begrundelse på de øvrige.
  for (const result of results) {
    for (const finding of result.findings) {
      if (finding.target.status.state === "not-satisfied") {
        assert.ok(finding.target.status.reason?.length > 0, `${finding.title} mangler reason`);
      }
    }
  }
});
