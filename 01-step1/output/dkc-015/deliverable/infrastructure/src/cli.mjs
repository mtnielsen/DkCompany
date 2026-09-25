#!/usr/bin/env node
/**
 * DKC-015 — CLI for infrastruktur, miljøadskillelse og staging.
 *
 *   node infrastructure/src/cli.mjs render          # skriv GitOps-manifester + apps + omkostning
 *   node infrastructure/src/cli.mjs check           # plan, IaC, rendering i sync, netværk, secrets, omkostning
 *   node infrastructure/src/cli.mjs verify          # GitOps-gates for dev/staging/prod + isolation
 *   node infrastructure/src/cli.mjs drift [--env staging]
 *   node infrastructure/src/cli.mjs iac-check
 *   node infrastructure/src/cli.mjs break-glass --request <fil>
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlan, RENDERED_ENVIRONMENTS } from "./plan.mjs";
import { renderPlan } from "./render.mjs";
import { checkNetworkIsolation } from "./netpol.mjs";
import { checkSecretInjection } from "./secrets.mjs";
import { checkCost, stagingCostDocument } from "./cost.mjs";
import { checkIac } from "./hcl.mjs";
import { detectDrift } from "./drift.mjs";
import { authorizeBreakGlass } from "./break-glass.mjs";
import { validateInfrastructurePlan } from "../../conformance/src/infrastructure.mjs";
import { runVerify } from "../../gitops/src/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");
export const COST_PATH = "docs/costs/staging.json";

function writeJson(root, rel, value) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function renderAll(root = repoRoot) {
  const { manifests, apps, plan } = renderPlan(root);
  for (const [rel, value] of [...manifests, ...apps]) writeJson(root, rel, value);
  writeJson(root, COST_PATH, stagingCostDocument(plan));
  return { manifests, apps, plan };
}

function listCommitted(root, dir) {
  const full = join(root, dir);
  return existsSync(full) ? readdirSync(full).filter((f) => f.endsWith(".json")).map((f) => `${dir}/${f}`) : [];
}

export function runCheck(root = repoRoot) {
  const problems = [];
  const plan = loadPlan(root);
  const validation = validateInfrastructurePlan(plan);
  for (const e of validation.errors) problems.push(`plan${e.path}: ${e.message}`);

  const iac = checkIac(root);
  for (const p of iac.problems) problems.push(`IaC: ${p}`);

  const { manifests, apps } = renderPlan(root);
  const rendered = new Map([...manifests, ...apps]);
  for (const [rel, value] of rendered) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make infrastructure-render'`);
    else if (readFileSync(path, "utf8") !== JSON.stringify(value, null, 2) + "\n") problems.push(`${rel} er ude af trit; kør 'make infrastructure-render'`);
  }
  const envDirs = (plan.environments ?? []).filter((e) => RENDERED_ENVIRONMENTS.includes(e.id)).map((e) => `gitops/manifests/${e.id}`);
  const appDirs = (plan.environments ?? []).filter((e) => RENDERED_ENVIRONMENTS.includes(e.id)).map((e) => `gitops/apps/${e.id}`);
  for (const dir of [...envDirs, ...appDirs]) {
    for (const rel of listCommitted(root, dir)) {
      if (!rendered.has(rel)) problems.push(`${rel} er ikke genereret fra planen`);
    }
  }
  if (existsSync(join(root, COST_PATH))) {
    const expected = JSON.stringify(stagingCostDocument(plan), null, 2) + "\n";
    if (readFileSync(join(root, COST_PATH), "utf8") !== expected) problems.push(`${COST_PATH} er ude af trit; kør 'make infrastructure-render'`);
  } else {
    problems.push(`${COST_PATH} mangler`);
  }

  const resources = [...manifests.values()];
  for (const p of checkNetworkIsolation(resources)) problems.push(`netværk: ${p}`);
  for (const p of checkSecretInjection(plan, resources)) problems.push(`secrets: ${p}`);
  for (const p of checkCost(plan).problems) problems.push(`omkostning: ${p}`);

  return { ok: problems.length === 0, problems, plan };
}

function main() {
  const [command] = process.argv.slice(2);
  const args = process.argv.slice(3);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  if (!command || ["--help", "-h"].includes(command)) {
    console.log("Brug: node infrastructure/src/cli.mjs <render|check|verify|drift|iac-check|break-glass>");
    return;
  }

  if (command === "render") {
    const { manifests, apps } = renderAll(repoRoot);
    console.log(`✔ Skrev ${manifests.size} manifester, ${apps.size} apps og ${COST_PATH}`);
  } else if (command === "check") {
    const result = runCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Infrastrukturkontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Infrastrukturplan, IaC, miljøadskillelse, netværk, secrets og omkostning er konsistent");
  } else if (command === "iac-check") {
    const result = checkIac(repoRoot);
    if (!result.ok) {
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ OpenTofu-modulet er pinnet, hærdet og uden klartekst-hemmeligheder");
  } else if (command === "verify") {
    const plan = loadPlan(repoRoot);
    let failed = false;
    for (const env of plan.environments) {
      const excluded = ["dummy-ok", "mattermost-adapter", "keycloak-adapter", "dummy-broken"].filter((m) => !(env.services ?? []).some((s) => s.module === m));
      const report = runVerify(repoRoot, { env: env.id, excludeModules: excluded });
      console.log(`${report.status === "pass" ? "✔" : "✘"} ${env.id}: ${report.summary.pass}/${report.summary.total} GitOps-gates`);
      if (report.status !== "pass") {
        failed = true;
        for (const c of report.checks.filter((c) => c.status === "fail")) for (const m of c.messages) console.error(`    - ${c.id} ${m}`);
      }
    }
    if (failed) process.exit(1);
  } else if (command === "drift") {
    const env = getArg("--env") ?? "staging";
    const result = detectDrift(repoRoot, env);
    if (result.status === "not-run") {
      console.log(`• NOT RUN — ${result.reason}`);
      return;
    }
    if (result.status === "in-sync") {
      console.log(`✔ ${env} er i sync med git (${result.desiredCount} ressourcer)`);
      return;
    }
    console.error(`✘ Drift i ${env}: ${result.actions?.length ?? 0} handlinger`);
    for (const action of result.actions ?? []) console.error(`    ${action.op} ${action.key}`);
    process.exit(1);
  } else if (command === "break-glass") {
    const path = getArg("--request");
    if (!path || !existsSync(path)) {
      console.error("break-glass kræver --request <fil>");
      process.exit(2);
    }
    const result = authorizeBreakGlass(JSON.parse(readFileSync(path, "utf8")), loadPlan(repoRoot));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  } else {
    console.error(`Ukendt kommando: ${command}`);
    process.exit(2);
  }
}

main();
