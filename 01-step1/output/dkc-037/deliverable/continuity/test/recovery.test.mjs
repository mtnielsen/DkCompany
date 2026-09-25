/**
 * DKC-037 — recovery-rapportering: foreslået vs. vedtaget vs. målt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecoveryReport, summarize, renderMarkdown } from "../src/recovery.mjs";

const NOW = Date.parse("2026-09-23T00:00:00Z");
const clock = () => NOW;

function serviceClass(overrides = {}) {
  return {
    file: "test.service-class.json",
    data: {
      metadata: { name: "svc-a" },
      moduleRef: "svc-a",
      criticality: "critical",
      availability: { targetPercent: 99.9, measurementWindowDays: 30, acceptedDowntime: false },
      durability: { confirmedWrites: { rpoMinutes: 0 }, regionFailure: { rpoMinutes: 15 }, corruption: { rpoMinutes: 1440 } },
      recovery: { rtoMinutes: 60 },
      backup: { restoreTested: true },
      failureModel: { networkPartition: { behavior: "fail-closed" } },
      deploymentProfileCompatibility: { profiles: ["multiple-servers"], haEligible: true, failureDomains: 3, nPlusOne: true, recoveryLocation: "eu-central-2" },
      serviceCommitment: { state: "accepted", acceptedBy: { name: "Anna Andersen" }, acceptedAt: "2026-09-23T08:00:00Z", measured: { availabilityPercent: 99.95, capturedAt: "2026-09-01T00:00:00Z", evidenceRef: "x", source: "probe" } },
      ...overrides,
    },
  };
}

test("en konfigurations-post er ikke et målt serviceniveau", () => {
  const report = buildRecoveryReport({ serviceClasses: [serviceClass()], clock });
  const entry = report.entries[0];
  assert.equal(entry.commitment, "accepted");
  assert.equal(entry.measured.status, "declared-only", "uden frisk probe er målingen kun erklæret");
  assert.equal(entry.haBadge, false, "HA-badge kræver en frisk failover-måling");
  assert.ok(entry.gaps.some((g) => /frisk probe/.test(g)));
});

test("en frisk availability- og failover-probe giver HA-badge", () => {
  const probes = [
    { moduleRef: "svc-a", kind: "availability", value: 99.97, capturedAt: "2026-09-01T00:00:00Z", evidenceRef: "probe://availability" },
    { moduleRef: "svc-a", kind: "failover", value: 1, capturedAt: "2026-09-01T00:00:00Z", evidenceRef: "probe://failover" },
  ];
  const report = buildRecoveryReport({ serviceClasses: [serviceClass()], probes, clock });
  const entry = report.entries[0];
  assert.equal(entry.measured.status, "measured");
  assert.equal(entry.measured.fresh, true);
  assert.equal(entry.haBadge, true);
  assert.equal(entry.productionReady, true);
});

test("en forældet probe tæller ikke som måling", () => {
  const probes = [{ moduleRef: "svc-a", kind: "availability", value: 99.99, capturedAt: "2025-01-01T00:00:00Z", evidenceRef: "probe://old" }];
  const report = buildRecoveryReport({ serviceClasses: [serviceClass()], probes, clock, freshnessDays: 90 });
  assert.equal(report.entries[0].measured.status, "declared-only");
  assert.equal(report.entries[0].haBadge, false);
});

test("en foreslået klasse kan hverken få HA-badge eller være produktionsklar", () => {
  const proposed = serviceClass({ serviceCommitment: { state: "proposed" } });
  const probes = [
    { moduleRef: "svc-a", kind: "availability", value: 99.99, capturedAt: "2026-09-01T00:00:00Z" },
    { moduleRef: "svc-a", kind: "failover", value: 1, capturedAt: "2026-09-01T00:00:00Z" },
  ];
  const report = buildRecoveryReport({ serviceClasses: [proposed], probes, clock });
  const entry = report.entries[0];
  assert.equal(entry.commitment, "proposed");
  assert.equal(entry.haBadge, false);
  assert.equal(entry.productionReady, false);
  assert.ok(entry.gaps.some((g) => /ikke vedtaget/.test(g)));
});

test("ikke-testet gendannelse giver en gap", () => {
  const noRestore = serviceClass({ backup: { restoreTested: false } });
  const report = buildRecoveryReport({ serviceClasses: [noRestore], clock });
  assert.ok(report.entries[0].gaps.some((g) => /gendannelse/.test(g)));
  assert.equal(report.entries[0].productionReady, false);
});

test("opsummering og markdown-rendering", () => {
  const report = buildRecoveryReport({ serviceClasses: [serviceClass(), serviceClass({ moduleRef: "svc-b", metadata: { name: "svc-b" }, serviceCommitment: { state: "proposed" } })], clock });
  const summary = summarize(report);
  assert.equal(summary.total, 2);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.proposed, 1);
  const md = renderMarkdown(report);
  assert.match(md, /Recovery-rapport/);
  assert.match(md, /svc-a/);
});
