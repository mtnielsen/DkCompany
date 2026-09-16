#!/usr/bin/env node
/**
 * 3.3 — CLI for ops-dashboards.
 *
 *   node observability/src/cli.mjs render   # Prometheus-regler til stdout
 *   node observability/src/cli.mjs write    # skriv GitOps-ConfigMaps
 *   node observability/src/cli.mjs check    # fejl hvis de committede filer er ude af trit
 *
 * Dashboards og regler genereres fra modulets manifest og committes, så Git er
 * den eneste ændringskanal. `check` forhindrer, at et SLO ændres i manifestet
 * uden at dashboardet følger med.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGitOpsConfigMaps, buildPrometheusRules } from "./generate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const outputDir = join(repoRoot, "gitops", "manifests", "dev");

export function loadModules(root = repoRoot) {
  const modulesDir = join(root, "modules");
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((dir) => existsSync(join(modulesDir, dir, "module-manifest.json")))
    .sort()
    .map((dir) => ({ name: dir, manifest: JSON.parse(readFileSync(join(modulesDir, dir, "module-manifest.json"), "utf8")) }));
}

export function buildArtifacts(root = repoRoot) {
  return buildGitOpsConfigMaps(loadModules(root));
}

export function write(root = repoRoot) {
  const dir = join(root, "gitops", "manifests", "dev");
  const artifacts = buildArtifacts(root);
  for (const [file, data] of Object.entries(artifacts)) {
    writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + "\n");
  }
  return Object.keys(artifacts);
}

export function check(root = repoRoot) {
  const artifacts = buildArtifacts(root);
  const problems = [];
  for (const [file, data] of Object.entries(artifacts)) {
    const path = join(root, "gitops", "manifests", "dev", file);
    const expected = JSON.stringify(data, null, 2) + "\n";
    if (!existsSync(path)) {
      problems.push(`${file} mangler`);
    } else if (readFileSync(path, "utf8") !== expected) {
      problems.push(`${file} er ude af trit med modulets SLO`);
    }
  }
  if (problems.length) {
    throw new Error(`${problems.join("; ")}. Kør 'make observability-dashboards'.`);
  }
}

const HELP = `Brug: node observability/src/cli.mjs <kommando>

Kommandøer:
  render   skriv Prometheus-regler til stdout
  write    skriv GitOps-ConfigMaps til gitops/manifests/dev
  check    fejl hvis de committede filer ikke matcher modulets SLO
`;

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "render") {
      process.stdout.write(JSON.stringify(buildPrometheusRules(loadModules()), null, 2) + "\n");
    } else if (command === "write") {
      const files = write();
      console.log(`✔ Observability skrevet: ${files.map((f) => relative(repoRoot, join(outputDir, f))).join(", ")}`);
    } else if (command === "check") {
      check();
      console.log("✔ Dashboards og regler matcher modulets SLO");
    } else {
      console.error(`Ukendt kommando: ${command}\n\n${HELP}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
