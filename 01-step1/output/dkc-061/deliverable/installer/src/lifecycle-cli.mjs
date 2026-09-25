#!/usr/bin/env node
/**
 * DKC-061 — CLI for produktlivscyklussen.
 *
 *   node installer/src/lifecycle-cli.mjs check                      # validér katalog, politik, offlinepakke og scenarier
 *   node installer/src/lifecycle-cli.mjs update <from> <to>         # vis en opdateringsplan
 *   node installer/src/lifecycle-cli.mjs remove <component> [mode]  # vis en fjernelsesplan
 *   node installer/src/lifecycle-cli.mjs support                    # byg en redigeret supportbundle
 *   node installer/src/lifecycle-cli.mjs offline                    # vis offlineberedskabet
 *   node installer/src/lifecycle-cli.mjs render                     # skriv livscyklusrapporten
 *   node installer/src/lifecycle-cli.mjs report                     # skriv livscyklusrapporten til stdout
 *   node installer/src/lifecycle-cli.mjs drill                      # kør den deterministiske kontrol
 *
 * En `check` og `drill` er deterministiske (`measured: false`). En rigtig
 * opdatering eller fjernelse på en levende installation er NOT RUN.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, REPORT_GENERATED_AT } from "./lifecycle-model.mjs";
import { buildUpdatePlan, executeUpdate } from "./lifecycle-update.mjs";
import { buildRemovalPlan } from "./lifecycle-remove.mjs";
import { buildSupportBundle } from "./lifecycle-support.mjs";
import { offlineReadiness } from "./lifecycle-offline.mjs";
import { runLifecycleCheck, buildLifecycleReport, PRINCIPALS } from "./lifecycle-check.mjs";
import { renderLifecycleReport } from "./lifecycle-report.mjs";
import { FileLifecycleStore } from "./lifecycle-store.mjs";

function loadKeyring(root = repoRoot) {
  return JSON.parse(readFileSync(join(root, "configuration", "dev-keyring.json"), "utf8"));
}
function loadProfile(root = repoRoot, name = "small-vps") {
  return JSON.parse(readFileSync(join(root, "catalog", "profiles", `${name}.profile.json`), "utf8"));
}
function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

async function main() {
  const command = process.argv[2];
  const all = loadAll(repoRoot);

  if (command === "check") {
    const result = await runLifecycleCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Livscykluskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Produktlivscyklussen er konsistent");
    return;
  }

  if (command === "update") {
    const [, , , from, to] = process.argv;
    const plan = buildUpdatePlan({ installationId: "acme-prod", fromRelease: from, toRelease: to, catalog: all.catalog, components: all.components, profile: loadProfile(), keyring: loadKeyring(), approval: { humanSubject: PRINCIPALS.ada.id, approvalRef: "approval://lifecycle/cli", twoPerson: true }, now: REPORT_GENERATED_AT });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (command === "execute-update") {
    const [, , , from, to] = process.argv;
    const keyring = loadKeyring();
    const plan = buildUpdatePlan({ installationId: "acme-prod", fromRelease: from, toRelease: to, catalog: all.catalog, components: all.components, profile: loadProfile(), keyring, approval: { humanSubject: PRINCIPALS.ada.id, approvalRef: "approval://lifecycle/cli", twoPerson: true }, now: REPORT_GENERATED_AT });
    const store = FileLifecycleStore.open(join(repoRoot, ".conformance-out", "lifecycle", "store"));
    store.setActiveRelease(from, { at: REPORT_GENERATED_AT });
    const target = all.catalog.releases.find((r) => r.id === to);
    const stepIds = plan.steps.filter((s) => s.mutating).map((s) => s.id);
    const result = await executeUpdate({ plan, store, keyring, executors: { run: async (step) => ({ ok: true, step: step.id }) }, authorization: { humanSubject: PRINCIPALS.ada.id, stepIds }, targetComponents: target.compatibilityLock, at: REPORT_GENERATED_AT });
    console.log(result.ok ? `✔ Opdatering gennemført (${plan.metadata.name})` : `✘ Opdatering fejlede: ${result.error}`);
    if (!result.ok) process.exit(1);
    return;
  }

  if (command === "remove") {
    const [, , , component, mode = "remove-only"] = process.argv;
    const plan = buildRemovalPlan({ installationId: "acme-prod", removeId: component, mode, components: all.components, profile: loadProfile(), installed: {}, exportRef: mode === "remove-and-delete-data" ? "export://acme/cli" : null, backupRef: mode === "remove-and-delete-data" ? "backup://acme/cli" : null, approval: { humanSubject: PRINCIPALS.ada.id, secondHumanSubject: PRINCIPALS.ben.id, approvalRef: "approval://lifecycle/cli", destructiveApproved: mode === "remove-and-delete-data" }, now: REPORT_GENERATED_AT });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (command === "support") {
    const bundle = buildSupportBundle({
      policy: all.support,
      installationId: "acme-prod",
      sources: {
        "installer-status": { status: "done", steps: 8, apiKey: "should-be-redacted" },
        "release-version": { release: all.catalog.releases.find((r) => r.channel === "stable").id },
        "component-versions": { "platform-core": "1.4.0" },
        "preflight-checks": { ok: true, checks: 24 },
      },
      at: REPORT_GENERATED_AT,
    });
    console.log(JSON.stringify(bundle, null, 2));
    return;
  }

  if (command === "offline") {
    console.log(JSON.stringify(offlineReadiness(all.offline, { online: false }), null, 2));
    return;
  }

  if (command === "render") {
    const { report } = await buildLifecycleReport(repoRoot);
    const rendered = renderLifecycleReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} livscyklusartefakter`);
    return;
  }

  if (command === "report") {
    const { report } = await buildLifecycleReport(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  if (command === "drill") {
    const result = await runLifecycleCheck(repoRoot);
    for (const s of result.report.scenarios) console.log(`${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} ${s.id}`);
    console.log(`${result.ok ? "PASS" : "FAIL"} lifecycle (${result.report.totals.releases} releases, ${result.report.totals.coreFlows} kerneflows)`);
    if (!result.ok) process.exit(1);
    return;
  }

  console.error("Brug: node installer/src/lifecycle-cli.mjs <check|update|execute-update|remove|support|offline|render|report|drill> [args]");
  process.exit(2);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
