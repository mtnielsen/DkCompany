#!/usr/bin/env node
/**
 * DKC-024 — CLI for live-integration og opgraderingsplaner.
 *
 *   node adapter-sdk/src/live-cli.mjs write    # genskab opgraderingsplaner + statusdokument
 *   node adapter-sdk/src/live-cli.mjs check    # fejl hvis planer/live-mål er ude af trit
 *   node adapter-sdk/src/live-cli.mjs plan     # vis opgraderings- og rollbackplanerne
 *   node adapter-sdk/src/live-cli.mjs run      # kør live-prøverne mod bindende endpoints
 *
 * `run` skriver en evidenspost pr. prøve med mode `integration`. Er
 * `DKC_LIVE_COMMIT` ikke sat, skrives en samlet NOT RUN-rapport med begrundelse —
 * et manglende driftsbevis bliver aldrig et pass.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLiveTargets, liveTargetsProblems, runAllLiveTargets } from "./live.mjs";
import { buildUpgradePlan, upgradePlanProblems } from "./upgrade.mjs";
import { validateAdapterUpgradePlan } from "../../conformance/src/adapter-live.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");
const statusDoc = join(repoRoot, "docs", "status", "adapter-live.md");

function loadJson(relPath) {
  const path = join(repoRoot, relPath);
  if (!existsSync(path)) throw new Error(`Mangler ${relPath}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadInputs(target) {
  return {
    profile: loadJson(target.releaseProfile),
    candidate: loadJson(target.candidate),
    manifest: loadJson(join("modules", target.module, "module-manifest.json")),
  };
}

function inputsLoader(manifest) {
  return (target) => {
    const { profile, candidate, manifest: moduleManifest } = loadInputs(target);
    return { profile, candidate, manifest: moduleManifest };
  };
}

function planPathFor(target) {
  return join(examplesDir, `upstream-upgrade-plan.${target.module}.example.json`);
}

function generatePlan(target, { profile, candidate }) {
  return buildUpgradePlan({
    adapter: target.module,
    current: target.pinned,
    target: target.upgrade.to,
    releaseProfile: profile,
    candidate,
    maxDowntimeMinutes: target.upgrade.maxDowntimeMinutes ?? 30,
  });
}

function writeStatusDoc(manifest, plans) {
  const lines = [
    "# Live-integration og opgradering",
    "",
    "> Genereret af `make adapter-live-write`. Redigér ikke manuelt.",
    "",
    "Hver adapter er pinnet til en eksakt upstream-version/edition og kræver en",
    "miljøbinding for at kunne bevises live. Uden bindingen er hver prøve **NOT RUN**.",
    "",
    "| Adapter | Pinnet version | Edition | Binding (adapter) | Decideret rollback |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const target of manifest.targets) {
    const plan = plans.find((p) => p.target.id === target.id)?.plan;
    lines.push(
      `| ${target.id} | ${target.pinned.version} | ${target.pinned.edition ?? "—"} | \`${target.bindings.adapterUrl}\` | ${plan ? `${plan.rollback.strategy} (${plan.status})` : "—"} |`
    );
  }
  lines.push(
    "",
    "De dokumenterede scope-, rate-limit- og restdataforhold pr. adapter står i",
    "`adapter-sdk/live-targets.json` og i `docs/spec/adapter-live-integration.md`.",
    "Kør `make adapter-live-run` for at prøve mod rigtige instanser.",
    ""
  );
  mkdirSync(dirname(statusDoc), { recursive: true });
  writeFileSync(statusDoc, lines.join("\n"));
}

function write() {
  const manifest = loadLiveTargets(repoRoot);
  const plans = [];
  for (const target of manifest.targets) {
    const inputs = loadInputs(target);
    const plan = generatePlan(target, inputs);
    writeFileSync(planPathFor(target), JSON.stringify(plan, null, 2) + "\n");
    plans.push({ target, plan });
    console.log(`✔ skrev upstream-upgrade-plan.${target.module}.example.json (${plan.status})`);
  }
  writeStatusDoc(manifest, plans);
  console.log("✔ skrev docs/status/adapter-live.md");
}

function check() {
  const manifest = loadLiveTargets(repoRoot);
  const problems = liveTargetsProblems(manifest, { load: inputsLoader(manifest) });
  for (const target of manifest.targets) {
    const inputs = loadInputs(target);
    const path = planPathFor(target);
    if (!existsSync(path)) {
      problems.push(`upstream-upgrade-plan.${target.module}.example.json mangler (kør 'make adapter-live-write')`);
      continue;
    }
    let committed;
    try {
      committed = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      problems.push(`upstream-upgrade-plan.${target.module}.example.json: ugyldig JSON (${err.message})`);
      continue;
    }
    const expected = generatePlan(target, inputs);
    if (JSON.stringify(committed) !== JSON.stringify(expected)) {
      problems.push(`upstream-upgrade-plan.${target.module}.example.json: er ude af trit (kør 'make adapter-live-write')`);
    }
    const result = validateAdapterUpgradePlan(committed, undefined, { releaseProfile: inputs.profile, candidate: inputs.candidate });
    if (!result.ok) problems.push(`upstream-upgrade-plan.${target.module}.example.json: ${result.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  }
  if (!existsSync(statusDoc)) problems.push("docs/status/adapter-live.md mangler");
  if (problems.length) {
    console.error("✘ Adapter-live-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ ${manifest.targets.length} adaptere: live-mål og opgraderingsplaner er pinnede, i trit og validerer`);
}

function plan() {
  const manifest = loadLiveTargets(repoRoot);
  for (const target of manifest.targets) {
    const inputs = loadInputs(target);
    const p = generatePlan(target, inputs);
    console.log(`\n== ${target.id}: ${p.from.version} → ${p.to.version} (${p.to.edition}) — ${p.status}`);
    for (const s of p.preflight) console.log(`   preflight  ${s.id}: ${s.criteria}`);
    for (const s of p.steps) console.log(`   trin       ${s.id}: ${s.criteria}`);
    for (const s of p.verification) console.log(`   verify     ${s.id}: ${s.criteria}`);
    console.log(`   rollback   ${p.rollback.strategy}: ${p.rollback.steps.map((s) => s.id).join(" → ")}`);
    if (p.blockers.length) console.log(`   blockers:  ${p.blockers.join("; ")}`);
  }
}

async function run() {
  const manifest = loadLiveTargets(repoRoot);
  const commit = process.env.DKC_LIVE_COMMIT;
  const binding = {
    commit,
    imageDigest: process.env.DKC_LIVE_IMAGE_DIGEST ?? null,
    environment: process.env.DKC_LIVE_ENVIRONMENT ?? "staging",
  };
  const runId = process.env.DKC_LIVE_RUN_ID ?? `live-${Date.now()}`;
  if (!commit) {
    const reason = "DKC_LIVE_COMMIT (og dermed bindende miljøvariabler) er ikke sat; ingen rigtige upstream-instanser eller credentials i dette miljø";
    console.log(`NOT RUN — ${reason}`);
    console.log("Sæt DKC_LIVE_COMMIT, DKC_LIVE_*_ADAPTER_URL og DKC_LIVE_*_ASSERTION for at køre mod rigtige instanser.");
    return;
  }
  const result = await runAllLiveTargets({ manifest, load: inputsLoader(manifest), binding, runId });
  const outDir = join(repoRoot, "evidence", "generated");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `adapter-live-${runId}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.summary));
  console.log(`✔ skrev ${outPath}`);
  if (result.summary.fail > 0) process.exit(1);
}

const command = process.argv[2];
try {
  if (command === "write") write();
  else if (command === "check") check();
  else if (command === "plan") plan();
  else if (command === "run") await run();
  else {
    console.error("Brug: node adapter-sdk/src/live-cli.mjs <write|check|plan|run>");
    process.exit(2);
  }
} catch (err) {
  console.error(err.stack ?? err.message);
  process.exit(1);
}
