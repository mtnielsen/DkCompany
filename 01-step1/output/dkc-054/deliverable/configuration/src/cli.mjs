#!/usr/bin/env node
/**
 * DKC-054 — operatør-CLI for den fælles konfiguration.
 *
 *   node configuration/src/cli.mjs show
 *   node configuration/src/cli.mjs validate <fil>
 *   node configuration/src/cli.mjs render
 *   node configuration/src/cli.mjs retention-preview
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot, loadDesiredState, loadHostScope, effectiveSettings, configurationDigest } from "./model.mjs";
import { validateConfigurationInput } from "./validate-api.mjs";
import { detectDrift } from "./desired-state.mjs";
import { renderConfigurationView } from "./ui.mjs";
import { debugState, renderDebugStatus, eventsRecordedAt } from "./debug.mjs";
import { previewRetentionChange } from "./retention-change.mjs";

function print(value) {
  process.stdout.write(typeof value === "string" ? value + "\n" : JSON.stringify(value, null, 2) + "\n");
}

const [, , command, arg] = process.argv;

if (command === "show") {
  const desired = loadDesiredState(repoRoot);
  // Den faktiske tilstand er (i denne statiske demo) den samme fil; drift vises ærligt.
  const actual = desired;
  const drift = detectDrift({ desired, actual });
  print({ installationId: desired.metadata.installationId, digest: configurationDigest(desired), effective: effectiveSettings(desired), drift, debug: renderDebugStatus(desired), audit: eventsRecordedAt(desired.installation.logLevel) });
} else if (command === "validate") {
  if (!arg) {
    console.error("Brug: node configuration/src/cli.mjs validate <fil>");
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(resolve(arg), "utf8"));
  const result = validateConfigurationInput(data, { source: "file" });
  print({ ok: result.ok, digest: result.digest, errors: result.errors });
  process.exit(result.ok ? 0 : 1);
} else if (command === "render") {
  const desired = loadDesiredState(repoRoot);
  print(renderConfigurationView({ desired, actual: desired }));
} else if (command === "retention-preview") {
  const desired = loadDesiredState(repoRoot);
  const preview = previewRetentionChange({
    installationId: desired.metadata.installationId,
    changeId: "cli-preview",
    current: desired.installation.retention,
    requested: [{ dataClass: "personal", fromDays: 90, toDays: 120 }],
    holds: [{ dataClass: "personal", legalHoldRef: "hold://acme/2026-01", worm: true, until: "2026-12-31T00:00:00Z" }],
    frame: { frameRef: desired.authorization.frameRef, approvedBy: desired.authorization.humanSubject, approvedAt: desired.authorization.grantedAt, minRetentionDays: 30, maxRetentionDays: 400 },
    authorization: desired.authorization,
  });
  print(preview);
} else {
  console.log("Kommandoer: show | validate <fil> | render | retention-preview");
  process.exit(command ? 2 : 0);
}
