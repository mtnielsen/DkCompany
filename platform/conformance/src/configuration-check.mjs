#!/usr/bin/env node
/**
 * DKC-054 — fokuseret check af installer og fælles konfiguration.
 *
 *   node conformance/src/configuration-check.mjs
 *
 * Kontrollerer at:
 *   - den kanoniske ønskede tilstand og host-scopet validerer (skema + semantik),
 *   - den deklarative fil og UI-eksemplet er samme dokument (én autoritativ kilde),
 *   - installationsplanen er signeret med en kendt nøgle og har gyldige trin,
 *   - diagnostikken ikke indeholder hemmeligheder,
 *   - debug udløber, og revisionssporet ikke kan slukkes med logniveauet,
 *   - retentionændringen respekterer holds/WORM/rammen,
 *   - tavs drift mellem ønsket og faktisk tilstand opdages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, contractsDir, buildAjv } from "./schemas.mjs";
import {
  validateConfigurationDir,
  validateHostScopeDir,
  validateInstallerPlanDir,
  validateRetentionChangePreviewDir,
} from "./configuration.mjs";
import { configurationDigest } from "../../configuration/src/model.mjs";
import { debugState, assertAuditTrailActive } from "../../configuration/src/debug.mjs";
import { detectDrift } from "../../configuration/src/desired-state.mjs";
import { verifyPlanSignature } from "../../installer/src/plan.mjs";
import { scanForSecrets } from "../../installer/src/diagnostics.mjs";

const examplesDir = join(contractsDir, "examples");
const now = Date.parse("2026-09-24T08:30:00Z");
const keyring = JSON.parse(readFileSync(join(repoRoot, "configuration/dev-keyring.json"), "utf8"));
const platforms = JSON.parse(readFileSync(join(repoRoot, "catalog/platforms.json"), "utf8")).platforms ?? [];
const ajv = buildAjv().ajv;
const problems = [];

const collect = (results, label) => {
  for (const result of results) {
    if (result.ok) continue;
    problems.push(`${label}: ${result.file}\n` + result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n"));
  }
};

const configurationResults = validateConfigurationDir(examplesDir);
collect(configurationResults, "konfiguration");
const hostScopeResults = validateHostScopeDir(examplesDir, { platforms });
collect(hostScopeResults, "host-scope");
const installerResults = validateInstallerPlanDir(examplesDir);
collect(installerResults, "installationsplan");
const previewResults = validateRetentionChangePreviewDir(examplesDir);
collect(previewResults, "retention-preview");

// Den kanoniske ønskede tilstand skal være identisk med UI/API-eksemplet.
const canonical = JSON.parse(readFileSync(join(repoRoot, "configuration/desired-state.json"), "utf8"));
const example = JSON.parse(readFileSync(join(examplesDir, "platform-configuration.example.json"), "utf8"));
if (configurationDigest(canonical) !== configurationDigest(example)) {
  problems.push("configuration/desired-state.json og UI-eksemplet er ikke samme dokument (flere kontrolkilder)");
}

// Revisionssporet må ikke kunne slukkes.
try {
  assertAuditTrailActive(canonical);
} catch (err) {
  problems.push(`revisionsspor: ${err.message}`);
}

// Debug-TTL: et aktivt debug i overrides skal udløbe.
const tenantOverride = (canonical.overrides ?? []).find((o) => o.scope === "tenant");
if (tenantOverride?.settings?.debug?.enabled === true) {
  const expires = Date.parse(tenantOverride.settings.debug.expiresAt ?? "");
  if (!Number.isFinite(expires)) problems.push("en aktiv debug-override mangler en TTL");
  else if (expires <= Date.parse(canonical.authorization.grantedAt)) problems.push("debug-TTL udløber ikke efter den blev aktiveret");
} else if (!debugState(canonical, now) || debugState(canonical, now).active) {
  // installationsniveauets debug skal være slukket
  if (canonical.installation.debug.enabled === true) problems.push("installationsniveauets debug er ikke slukket som standard");
}

// Signeret plan.
const plan = JSON.parse(readFileSync(join(examplesDir, "installer-plan.example.json"), "utf8"));
const verified = verifyPlanSignature(plan, keyring);
if (!verified.ok) problems.push(`installationsplan: ${verified.reason}`);
if (scanForSecrets(JSON.stringify(plan)).length) problems.push("installationsplanens diagnostik indeholder hemmelighedssignaturer");

// Drift: ønsket == faktisk giver ingen drift; en afvigelse opdages.
if (detectDrift({ desired: canonical, actual: canonical }).drift) problems.push("identisk ønsket/faktisk tilstand giver falsk drift");
const drifted = structuredClone(canonical);
drifted.installation.logLevel = "error";
if (!detectDrift({ desired: canonical, actual: drifted }).drift) problems.push("en afvigelse i logniveau opdages ikke som drift");

if (problems.length === 0) {
  console.log(`✔ ${configurationResults.length} platform-konfiguration valideret (skema + sikre standarder/retention/WORM/modelruter)`);
  console.log(`✔ ${hostScopeResults.length} host-scope valideret (skema + supportmatrix/forbud/recovery)`);
  console.log(`✔ ${installerResults.length} signeret installationsplan valideret (preflight + idempotente trin + restriktioner)`);
  console.log(`✔ ${previewResults.length} retentionændrings-preview valideret (holds/WORM/ramme)`);
  console.log("✔ én autoritativ ønsket tilstand (fil == UI-eksempel), revisionsspor kan ikke slukkes, tavs drift opdages");
  process.exit(0);
}
console.error("✘ Konfigurations-/installer-validering fejlede:\n");
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
