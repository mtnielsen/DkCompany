import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAjv, validate, SCHEMA_IDS } from "../src/schemas.mjs";

test("alle kontraktskemaer kan kompileres i strict mode", () => {
  assert.doesNotThrow(() => buildAjv({ strict: true }));
});

test("privacy-response afviser partial uden reason", () => {
  const { ajv } = buildAjv();
  const response = {
    requestId: "018f3c2a-1b2c-7def-8a01-cccccccccccc",
    verb: "subject.erase",
    completedAt: "2025-09-01T10:00:42Z",
    status: "partially-completed",
    results: [{ module: "m", verb: "subject.erase", status: "partial" }],
    summary: { modulesQueried: 1, full: 0, partial: 1, unsupported: 0, failed: 0 },
  };
  const { ok, errors } = validate(ajv, SCHEMA_IDS.privacyResponse, response);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.message.includes("reason")));
});

test("module-manifest afviser full uden fixture/probe-bevis", () => {
  const { ajv } = buildAjv();
  const manifest = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ModuleManifest",
    metadata: { name: "x", version: "1.0.0", description: "d", owner: { team: "t" } },
    identity: {
      userStore: "none",
      oidc: { issuer: "https://id.example.org", clientId: "x" },
      scim: { version: "2.0", endpoint: "https://id.example.org/scim", mode: "consumer" },
      spiffe: { spiffeId: "spiffe://td/x", trustDomain: "td" },
    },
    telemetry: {
      serviceName: "x",
      otel: { exporter: "otlp-grpc", signals: ["traces", "metrics", "logs"] },
      cloudEvents: { source: "urn:x", typePrefix: "dk.x.", sink: "https://s", requiredAttributes: ["tenantid", "traceid", "principal"] },
    },
    policy: {
      pdp: { endpoint: "https://pdp.example.org/v1/data/platform/ops/decision", protocol: "http-json", decisionTtlSeconds: 60 },
      bundle: { name: "platform", version: "1.0.0", sha256: "baeeeb11cb003454ccd12473856966c8769388870d74f30428dfc9bd20ba2d86" },
      failMode: "closed",
      gatedVerbs: ["restore", "upgrade", "migrate", "rollback", "drain", "subject.erase", "subject.export", "subject.legal_hold"],
      evidence: { kind: "fixture", ref: "conformance/evidence/policy-decision.json" },
    },
    verbs: Object.fromEntries(
      ["backup", "restore", "verify-restore", "drain", "upgrade.dry-run", "upgrade", "migrate", "rollback", "health", "slo"].map((v) => [
        v,
        v === "health"
          ? { conformance: "full", endpoint: "https://x/health", evidence: { kind: "declared", ref: "trust me" } }
          : { conformance: "unsupported", reason: "kan ikke i denne version" },
      ])
    ),
    privacy: {
      "subject.locate": { conformance: "unsupported", reason: "ingen persondata her" },
      "subject.export": { conformance: "unsupported", reason: "ingen persondata her" },
      "subject.erase": { conformance: "unsupported", reason: "ingen persondata her" },
      "subject.legal_hold": { conformance: "unsupported", reason: "ingen persondata her" },
      "retention.policy": { conformance: "unsupported", reason: "ingen persondata her" },
    },
  };
  const { ok, errors } = validate(ajv, SCHEMA_IDS.moduleManifest, manifest);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.path.includes("/verbs/health/evidence/kind")));
});

test("policy-decision kræver requiredApprovals ved allow-with-approval", () => {
  const { ajv } = buildAjv();
  const decision = {
    decision: "allow-with-approval",
    pdp: { name: "platform-pdp", version: "1.0.0", bundleVersion: "1.0.0" },
    matchedRules: ["r"],
    evaluatedAt: "2025-09-01T00:00:00Z",
    inputSha256: "0".repeat(64),
  };
  const { ok, errors } = validate(ajv, SCHEMA_IDS.policyDecision, decision);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.message.includes("requiredApprovals")));
});

test("policy-decision kræver begrundelse ved deny", () => {
  const { ajv } = buildAjv();
  const decision = {
    decision: "deny",
    pdp: { name: "platform-pdp", version: "1.0.0", bundleVersion: "1.0.0" },
    matchedRules: [],
    evaluatedAt: "2025-09-01T00:00:00Z",
    inputSha256: "0".repeat(64),
  };
  const { ok } = validate(ajv, SCHEMA_IDS.policyDecision, decision);
  assert.equal(ok, false);
});
