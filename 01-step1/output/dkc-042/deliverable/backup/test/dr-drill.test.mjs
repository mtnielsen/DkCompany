import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryKeyProvider } from "../src/keys.mjs";
import { createSuppressionLedger } from "../src/suppression.mjs";
import { createWalArchive } from "../src/dr/pitr.mjs";
import { runDisasterRecoveryDrill } from "../src/dr/drill.mjs";
import { loadDisasterRecoveryPlan } from "../src/dr/plan.mjs";
import { validateDisasterRecoveryDrill } from "../../conformance/src/disaster-recovery.mjs";
import { createFixture } from "./support/fixtures.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE_AT = "2026-09-20T02:00:00Z";

function prepare(fixture, dir) {
  fixture.db.exec("CREATE TABLE acl_entries(subject TEXT PRIMARY KEY, role TEXT, updated_at TEXT)");
  fixture.db.exec("CREATE TABLE recovery_data(id INTEGER PRIMARY KEY, tenant_id TEXT, value TEXT, at TEXT)");
  fixture.db.run("INSERT INTO acl_entries(subject, role, updated_at) VALUES (?, ?, ?)", "oidc|anna.andersen", "platform-owner", BASE_AT);
  fixture.db.run("INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", 1, "acme", "a", BASE_AT);
  const wal = createWalArchive({ dir: join(dir, "wal") });
  wal.append({ at: "2026-09-20T02:01:00Z", tenantId: "acme", table: "recovery_data", sql: "INSERT INTO recovery_data(id, tenant_id, value, at) VALUES (?, ?, ?, ?)", params: [2, "acme", "b", "2026-09-20T02:01:00Z"] });
  wal.append({ at: "2026-09-20T02:04:00Z", tenantId: "acme", kind: "acl", table: "acl_entries", sql: "INSERT INTO acl_entries(subject, role, updated_at) VALUES (?, ?, ?)", params: ["oidc|cont.officer", "continuity-officer", "2026-09-20T02:04:00Z"] });
  return wal;
}

async function run({ plan, fixture, dir, wal, lastCommittedWriteAt }) {
  return runDisasterRecoveryDrill({
    plan,
    tenantId: "acme",
    workDir: join(dir, "dr"),
    db: fixture.db,
    baseAcl: { "oidc|anna.andersen": "platform-owner" },
    walArchive: wal,
    targetTime: "2026-09-20T02:01:00Z",
    walBaseAt: BASE_AT,
    keyProvider: createMemoryKeyProvider(),
    suppressionLedger: createSuppressionLedger({ path: join(dir, "suppression.ndjson") }),
    config: { dns: { zone: "recovery.example.org" }, endpoint: "https://recovery.example.org" },
    objectFiles: [{ name: "reports/tenant.json", bytes: Buffer.from("{}") }],
    lastCommittedWriteAt: lastCommittedWriteAt ?? "2026-09-20T02:01:00Z",
  });
}

test("en fuld DR-øvelse genopretter kundepakken uden primærklyngen og måler brugerflowet", async () => {
  const fixture = createFixture();
  const dir = mkdtempSync(join(tmpdir(), "dkc-dr-drill-"));
  try {
    const wal = prepare(fixture, dir);
    const { report } = await run({ plan: loadDisasterRecoveryPlan(repoRoot), fixture, dir, wal });
    const validation = validateDisasterRecoveryDrill(report);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    assert.equal(report.gate.status, "pass", JSON.stringify(report.gate.reasons));
    assert.equal(report.primaryClusterAvailable, false);
    assert.equal(report.restore.knownCleanPoint, true);
    assert.equal(report.deletionJournal.applied, true);
    assert.equal(report.measured, false);
    assert.ok(report.measurements.stepsRestored >= 3);
    assert.ok(report.measurements.measuredRtoMinutes >= report.measurements.databaseOnlyRtoMinutes);
    for (const dep of ["iam", "dns", "secret-store"]) {
      assert.equal(report.dependencyRecovery.find((d) => d.component === dep)?.recovered, true, dep);
    }
    assert.equal(report.functionalChecks.every((c) => c.status === "pass"), true, JSON.stringify(report.functionalChecks));
  } finally {
    fixture.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("et for stort datatab spærrer DR-gaten men rapporten er stadig gyldig", async () => {
  const fixture = createFixture();
  const dir = mkdtempSync(join(tmpdir(), "dkc-dr-drill-"));
  try {
    const wal = prepare(fixture, dir);
    const plan = structuredClone(loadDisasterRecoveryPlan(repoRoot));
    plan.userFlow.rpoMinutes = 0;
    const { report } = await run({ plan, fixture, dir, wal, lastCommittedWriteAt: "2026-09-20T01:55:00Z" });
    assert.equal(report.gate.status, "blocked");
    assert.ok(report.gate.reasons.some((r) => /RPO|datatab/.test(r)));
    assert.equal(validateDisasterRecoveryDrill(report).ok, true, JSON.stringify(validateDisasterRecoveryDrill(report).errors));
  } finally {
    fixture.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
