/**
 * DKC-033 — test af pilotscenarierne, abuse-proberne og belastningstesten.
 *
 * Kører de faktiske førstepartsmoduler for én virksomhedsprofil og beviser at
 * godkendelser, kundeisolering og ubetroet indhold ikke kan omgås.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll } from "../src/model.mjs";
import { runPilotScenarios, runAbuseProbes, runBoundedLoad, probeApprovalBypass, probeTenantIsolation, probeInjection, categoryFor } from "../src/scenarios.mjs";

const all = loadAll(repoRoot);

test("approval-binding afviser en ændret eller omdirigeret godkendelse", () => {
  assert.deepEqual(probeApprovalBypass(), []);
});

test("kundeisoleringen afviser krydskunde-kontekst og tenant-headere", () => {
  assert.deepEqual(probeTenantIsolation(), []);
});

test("ubetroet indhold bliver ikke til en handling", () => {
  assert.deepEqual(probeInjection(), []);
});

test("abuse-proberne finder nul åbne omgåelser", async () => {
  const result = await runAbuseProbes();
  assert.ok(result.probes.length >= 3);
  assert.deepEqual(result.violations, []);
});

test("den afgrænsede belastningstest har nul fejl og nul omgåelser", async () => {
  const result = await runBoundedLoad({ iterations: 24, concurrency: 6 });
  assert.equal(result.bounded, true);
  assert.equal(result.iterations, 24);
  assert.equal(result.failures, 0);
  assert.equal(result.bypasses, 0);
});

test("SMV-profilen gennemfører alle seks arbejdsgange", async () => {
  const smv = all.scenarios.scenarios.filter((s) => s.profileRef === "smv");
  assert.equal(smv.length, 6);
  const workRoot = mkdtempSync(join(tmpdir(), "dkc033-test-"));
  try {
    const outcomes = await runPilotScenarios({ profiles: all.profiles, scenarios: { ...all.scenarios, scenarios: smv }, workRoot });
    assert.equal(outcomes.length, 6);
    for (const outcome of outcomes) assert.equal(outcome.status, "passed", `${outcome.scenarioId}: ${outcome.problems.join("; ")}`);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("integrationskategorien slår op i profilen", () => {
  const enterprise = all.profiles.profiles.find((p) => p.id === "enterprise");
  assert.equal(categoryFor(enterprise, "host-management")?.availability, "opt-in");
  assert.equal(categoryFor(enterprise, "finance-erp")?.availability, "unavailable");
});
