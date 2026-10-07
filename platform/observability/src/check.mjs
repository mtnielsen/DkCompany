#!/usr/bin/env node
/**
 * DKC-017 — fokuseret kontrol af sensorkatalog og alarmregler.
 *
 *   node observability/src/check.mjs
 *
 * Kontrollerer offline at:
 *   - sensorkataloget og alarmreglerne validerer mod kontrakterne,
 *   - hver alarmregel peger på en kendt sensor og en kendt modtager,
 *   - hver sensor/regel har en navngivet ejer, en runbook der findes og en
 *     friskhedsgrænse der giver mening.
 *
 * Der køres ingen levende backend; det er `monitoring-test` og `monitoring-drill`
 * der efterprøver adfærden.
 */
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateSensorRegistry, validateAlertRuleSet } from "../../conformance/src/monitoring.mjs";
import { loadSensorRegistry } from "./sensors.mjs";
import { loadAlertRules } from "./alerts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

export function runCheck(root = repoRoot) {
  const { ajv } = buildAjv();
  const problems = [];

  const registry = loadSensorRegistry(root);
  const registryResult = validateSensorRegistry(registry, ajv, { root });
  for (const e of registryResult.errors) problems.push(`sensorkatalog${e.path}: ${e.message}`);

  const sensorIds = new Set((registry.sensors ?? []).map((s) => s.id));
  const alertRules = loadAlertRules(root);
  const recipientIds = new Set((alertRules.rules ?? []).flatMap((r) => (r.recipients ?? []).map((x) => x.id)));
  const ruleResult = validateAlertRuleSet(alertRules, ajv, { root, sensorIds, recipientIds });
  for (const e of ruleResult.errors) problems.push(`alarmregler${e.path}: ${e.message}`);

  return { problems, registry, alertRules, sensorIds, recipientIds };
}

function main() {
  const { problems, registry, alertRules } = runCheck();
  if (problems.length) {
    console.error("✘ DKC-017-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Sensorkatalog valid: ${registry.sensors.length} sensorer`);
  console.log(`✔ Alarmregler valid: ${alertRules.rules.length} regler med ejer, eskalation og runbook`);
  console.log(`✔ Alle runbooks findes: ${[...new Set([...registry.sensors, ...alertRules.rules].map((x) => x.runbook))].map((p) => relative(repoRoot, join(repoRoot, p))).join(", ")}`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
