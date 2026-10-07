/**
 * DKC-065 — test af den isolerede sikkerheds-regressionsharness.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runSecurityHarness, authorizeHarnessRun, PROBE_SPECS, HARNESS_CATEGORIES } from "../src/harness.mjs";
import { loadRulesOfEngagement, REPORT_GENERATED_AT } from "../src/model.mjs";

const root = join(import.meta.dirname, "..", "..");
const now = Date.parse(REPORT_GENERATED_AT);
const roe = loadRulesOfEngagement(root);

test("harnessen kører alle sonder mod det autoriserede lokale mål", async () => {
  const target = roe.targets.find((t) => t.id === "local-loopback");
  const run = await runSecurityHarness({ root, roe, target, now });
  assert.equal(run.authorized, true);
  assert.equal(run.probes.length, PROBE_SPECS.length);
  assert.equal(run.summary.passed, PROBE_SPECS.length);
  assert.equal(run.summary.failed, 0);
  const categories = new Set(run.probes.map((p) => p.category));
  for (const category of HARNESS_CATEGORIES) assert.ok(categories.has(category), category);
});

test("en kørsel mod et uautoriseret eksternt mål udfører ingen sonder", async () => {
  const target = roe.targets.find((t) => t.id === "staging-platform");
  const run = await runSecurityHarness({ root, roe, target, now });
  assert.equal(run.authorized, false);
  assert.equal(run.probes.length, 0);
  assert.ok(run.reasons.length > 0);
});

test("autorisation fejler lukket uden for tidsvinduet", () => {
  const target = roe.targets.find((t) => t.id === "local-loopback");
  const decision = authorizeHarnessRun({ target, roe, now: Date.parse("2027-01-01T00:00:00Z") });
  assert.equal(decision.authorized, false);
  assert.ok(decision.reasons.some((r) => /tidsvinduet/.test(r)));
});

test("autorisation fejler lukket når engagementet ikke er åbent", () => {
  const target = roe.targets.find((t) => t.id === "local-loopback");
  const closed = { ...roe, window: { ...roe.window, status: "closed" } };
  const decision = authorizeHarnessRun({ target, roe: closed, now });
  assert.equal(decision.authorized, false);
});
