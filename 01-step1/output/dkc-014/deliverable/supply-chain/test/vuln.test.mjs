import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySeverity, evaluateVulnerabilities, queryOsv } from "../src/vuln.mjs";

const policy = { ecosystem: "npm", failOn: ["critical", "high"], maxCacheAgeDays: 30, maxExceptionDays: 90, exceptions: [] };

function scanWith(advisory, { ageDays = 0 } = {}) {
  return {
    schemaVersion: 1,
    ecosystem: "npm",
    source: "test",
    queriedAt: new Date(Date.now() - ageDays * 86_400_000).toISOString(),
    dependencies: [{ name: "left-pad", version: "1.0.0", vulns: [advisory.id] }],
    advisories: { [advisory.id]: advisory },
  };
}

const high = { id: "GHSA-1", aliases: [], summary: "ReDoS", severity: "high", fixedVersions: { "left-pad": "1.0.1" } };

test("en high-advisory uden undtagelse blokerer", () => {
  const result = evaluateVulnerabilities(scanWith(high), policy);
  assert.equal(result.ok, false);
  assert.equal(result.summary.failed, 1);
  assert.match(result.problems[0], /GHSA-1/);
});

test("en gyldig, tidsbegrænset undtagelse med navngivet ejer accepterer", () => {
  const withException = {
    ...policy,
    exceptions: [
      {
        id: "GHSA-1",
        package: "left-pad",
        reason: "Afventer opgradering",
        owner: { subject: "oidc|cecilia", name: "Cecilia", role: "Security Owner" },
        approvedAt: new Date(Date.now() - 86_400_000).toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    ],
  };
  const result = evaluateVulnerabilities(scanWith(high), withException);
  assert.equal(result.ok, true);
  assert.equal(result.summary.excepted, 1);
});

test("en forældet scanning afvises", () => {
  const result = evaluateVulnerabilities(scanWith(high, { ageDays: 100 }), policy);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /ældre/.test(p)));
});

test("queryOsv samler advisories via den injicerede fetch", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("querybatch")) {
      return { ok: true, json: async () => ({ results: [{ vulns: [{ id: "GHSA-1" }] }] }) };
    }
    return {
      ok: true,
      json: async () => ({ id: "GHSA-1", summary: "x", aliases: ["CVE-1"], database_specific: { severity: "HIGH" }, affected: [{ package: { name: "left-pad" }, ranges: [{ events: [{ fixed: "1.0.1" }] }] }] }),
    };
  };
  const scan = await queryOsv([{ name: "left-pad", version: "1.0.0" }], { fetchImpl, now: () => new Date("2026-09-23T00:00:00.000Z") });
  assert.equal(scan.queriedAt, "2026-09-23T00:00:00.000Z");
  assert.equal(classifySeverity({ database_specific: { severity: "HIGH" } }), "high");
  assert.deepEqual(scan.advisories["GHSA-1"].fixedVersions, { "left-pad": "1.0.1" });
});
