import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryKeyProvider } from "../src/keys.mjs";
import { createSuppressionLedger } from "../src/suppression.mjs";
import { latestWriteAt, runRestoreDrill } from "../src/drill.mjs";
import { validateRestoreDrill } from "../../conformance/src/backup.mjs";
import { createFixture } from "./support/fixtures.mjs";

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-drill-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function stepClock(startIso) {
  let t = Date.parse(startIso);
  return () => {
    t += 1000;
    return t;
  };
}

async function run({ fixture, dir, rtoTargetMinutes, rpoTargetMinutes, checkpoint = null }) {
  const ledger = createSuppressionLedger({ path: join(dir, "suppression.ndjson") });
  const keyProvider = createMemoryKeyProvider();
  return runRestoreDrill({
    db: fixture.db,
    tenantId: "acme",
    workDir: join(dir, "work"),
    keyProvider,
    suppressionLedger: ledger,
    source: { moduleRef: "audit-service", serviceClassRef: "continuity/service-classes/audit-service.service-class.json" },
    config: { endpoint: "https://example.org", database: { password: "hunter2" } },
    objectFiles: [{ name: "reports/q3.json", bytes: Buffer.from("{}") }],
    lastCommittedWriteAt: "2026-09-23T07:59:00.000Z",
    rpoTargetMinutes,
    rtoTargetMinutes,
    checkpoint,
    clock: stepClock("2026-09-23T08:00:00.000Z"),
  });
}

test("en gennemført øvelse måler RPO/RTO og giver en pass-gate", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const { report } = await run({
      fixture,
      dir,
      rtoTargetMinutes: 60,
      rpoTargetMinutes: 15,
      checkpoint: { anchorDir: fixture.anchorDir, secret: "anchor-secret", tenantId: "acme" },
    });
    const validation = validateRestoreDrill(report);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    assert.equal(report.gate.status, "pass");
    assert.equal(report.isolated, true);
    assert.equal(report.integrity.databaseOk, true);
    assert.equal(report.integrity.checksumsVerified, true);
    assert.equal(report.audit.checkpointOk, true);
    assert.ok(report.measurements.measuredRtoMinutes > 0);
    assert.ok(report.measurements.dataLossMinutes > 0 && report.measurements.dataLossMinutes < 5);
    assert.ok(report.functionalChecks.every((c) => c.status === "pass"));
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("et for stramt RTO-mål spærrer gaten", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const { report } = await run({ fixture, dir, rtoTargetMinutes: 0, rpoTargetMinutes: 15 });
    assert.equal(report.gate.status, "blocked");
    assert.ok(report.gate.reasons.some((r) => /RTO/.test(r)));
    assert.equal(validateRestoreDrill(report).ok, true);
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("et for stramt RPO-mål spærrer gaten", async () => {
  const fixture = createFixture();
  const { dir, cleanup } = workDir();
  try {
    const { report } = await run({ fixture, dir, rtoTargetMinutes: 60, rpoTargetMinutes: 0 });
    assert.equal(report.gate.status, "blocked");
    assert.ok(report.gate.reasons.some((r) => /RPO|datatab/.test(r)));
  } finally {
    fixture.cleanup();
    cleanup();
  }
});

test("latestWriteAt finder den seneste skrivning", () => {
  const fixture = createFixture();
  try {
    const at = latestWriteAt(fixture.db);
    assert.ok(at, "der skal være mindst ét tidsstempel");
    assert.ok(!Number.isNaN(Date.parse(at)));
  } finally {
    fixture.cleanup();
  }
});
