#!/usr/bin/env node
/**
 * DKC-054 — operatør-CLI for installatøren.
 *
 *   node installer/src/cli.mjs preflight
 *   node installer/src/cli.mjs plan
 *   node installer/src/cli.mjs status
 *   node installer/src/cli.mjs diagnose
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, loadDesiredState, loadHostScope, configurationDigest, INSTALLER_STATE_PATH } from "../../configuration/src/model.mjs";
import { previewRetentionChange } from "../../configuration/src/retention-change.mjs";
import { runPreflight } from "./preflight.mjs";
import { buildInstallerPlan, signPlan, planDigest, verifyPlanSignature } from "./plan.mjs";
import { createInstallStateStore } from "./state.mjs";
import { buildDiagnostics, redactSecrets } from "./diagnostics.mjs";

function print(value) {
  process.stdout.write((typeof value === "string" ? value : JSON.stringify(value, null, 2)) + "\n");
}

const [, , command] = process.argv;
const platforms = JSON.parse(readFileSync(join(repoRoot, "catalog/platforms.json"), "utf8")).platforms ?? [];
const config = loadDesiredState(repoRoot);
const hostScope = loadHostScope(repoRoot);
const configDigest = configurationDigest(config);
const keyring = JSON.parse(readFileSync(join(repoRoot, "configuration/dev-keyring.json"), "utf8"));

if (command === "preflight") {
  const result = runPreflight({ hostScope, platformMatrix: platforms, config, configDigest, disks: [], existingDatabase: null });
  print(result);
  process.exit(result.ok ? 0 : 1);
} else if (command === "plan") {
  const preflight = runPreflight({ hostScope, platformMatrix: platforms, config, configDigest, disks: [], existingDatabase: null });
  const plan = buildInstallerPlan({
    installationId: config.metadata.installationId,
    profile: { metadata: { name: "small-vps" } },
    platformId: hostScope.os.supportedMatrixRef,
    hostScope,
    configDigest,
    preview: { result: { closure: ["platform-core", "identity-broker", "audit-service"] } },
    preflight,
    components: [
      { metadata: { name: "platform-core" }, componentType: "security-core" },
      { metadata: { name: "identity-broker" }, componentType: "security-core" },
      { metadata: { name: "audit-service" }, componentType: "security-core" },
    ],
    now: new Date().toISOString(),
  });
  const signed = signPlan(plan, { keyId: keyring.keys[0].keyId, secret: keyring.keys[0].secret });
  print({ digest: planDigest(signed), verified: verifyPlanSignature(signed, keyring).ok, plan: signed });
} else if (command === "status") {
  const store = createInstallStateStore({ path: join(repoRoot, INSTALLER_STATE_PATH) });
  const state = store.load();
  print(state ?? { status: "not-started", reason: "ingen installationstilstand endnu" });
} else if (command === "diagnose") {
  const bundle = buildDiagnostics({ artifactRef: "diagnostics://installer/cli", payload: { installationId: config.metadata.installationId, logLevel: config.installation.logLevel, secrets: { apiKey: "should-be-redacted" } } });
  print({ redacted: bundle.redacted, secretScan: bundle.secretScan, content: redactSecrets(bundle.content) });
} else {
  console.log("Kommandoer: preflight | plan | status | diagnose");
  process.exit(command ? 2 : 0);
}
