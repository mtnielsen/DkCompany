import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeTrivy, normalizeFalco, normalizeWazuh, summarize, statusFor, wazuhSeverity } from "../src/normalize.mjs";
import { loadBundle, check, outputPath } from "../src/cli.mjs";

const meta = { capturedAt: "2025-09-01T10:00:00Z", target: "target" };

test("statusFor er konservativ: critical/high giver fail, medium/low giver partial", () => {
  assert.equal(statusFor(summarize([])), "pass");
  assert.equal(statusFor(summarize([{ severity: "low" }])), "partial");
  assert.equal(statusFor(summarize([{ severity: "medium" }])), "partial");
  assert.equal(statusFor(summarize([{ severity: "high" }])), "fail");
  assert.equal(statusFor(summarize([{ severity: "critical" }])), "fail");
});

test("normalizeTrivy oversætter vulnerabilities og misconfigurations", () => {
  const report = normalizeTrivy(
    {
      ArtifactName: "repo",
      Results: [
        {
          Target: "package-lock.json",
          Vulnerabilities: [
            { VulnerabilityID: "CVE-1", PkgName: "p", InstalledVersion: "1.0.0", FixedVersion: "1.0.1", Severity: "HIGH", Description: "d" },
          ],
          Misconfigurations: [{ ID: "AVD-1", Title: "t", Severity: "LOW", CauseMetadata: { Resource: "Deployment/x" } }],
        },
      ],
    },
    meta
  );
  assert.equal(report.scanner, "trivy");
  assert.equal(report.status, "fail");
  assert.deepEqual(report.summary, { critical: 0, high: 1, medium: 0, low: 1, total: 2 });
  assert.match(report.findings[0].remediation, /Opgrader til 1\.0\.1/);
  assert.equal(report.findings[1].resource, "Deployment/x");
});

test("normalizeFalco og normalizeWazuh mapper prioritet og level til severitet", () => {
  const falco = normalizeFalco(
    [{ rule: "r", priority: "Warning", output: "o", output_fields: { "k8s.pod.name": "pod-1" } }],
    meta
  );
  assert.equal(falco.status, "partial");
  assert.equal(falco.findings[0].severity, "medium");
  assert.equal(falco.findings[0].resource, "pod-1");

  assert.equal(wazuhSeverity(13), "critical");
  assert.equal(wazuhSeverity(8), "high");
  assert.equal(wazuhSeverity(5), "medium");
  assert.equal(wazuhSeverity(2), "low");
  const wazuh = normalizeWazuh([{ rule: { id: "5501", level: 10, description: "d" }, agent: { name: "node-1" } }], meta);
  assert.equal(wazuh.status, "fail");
  assert.equal(wazuh.findings[0].severity, "high");
  assert.equal(wazuh.findings[0].resource, "node-1");
});

test("den normaliserede pakke validerer mod kontrakten og matcher rådata", () => {
  const bundle = loadBundle();
  assert.equal(bundle.kind, "SecurityFindings");
  assert.equal(bundle.reports.length, 3);
  const byScanner = Object.fromEntries(bundle.reports.map((r) => [r.scanner, r]));
  assert.equal(byScanner.trivy.status, "partial");
  assert.equal(byScanner.trivy.summary.medium, 1);
  assert.equal(byScanner.falco.status, "partial");
  assert.equal(byScanner.wazuh.status, "pass");
  assert.ok(bundle.reports.every((r) => r.artifact.sha256.match(/^[a-f0-9]{64}$/)));

  assert.doesNotThrow(() => check());
  assert.equal(readFileSync(outputPath, "utf8"), JSON.stringify(bundle, null, 2) + "\n");
});
