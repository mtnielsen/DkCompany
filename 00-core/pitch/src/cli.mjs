#!/usr/bin/env node
/**
 * 4.3 — CLI: `node pitch/src/cli.mjs check`.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log("Brug: node pitch/src/cli.mjs check");
    return;
  }
  if (command !== "check") {
    console.error(`Ukendt kommando: ${command}`);
    process.exit(2);
  }
  const result = check({ repoRoot });
  if (!result.ok) {
    console.error("✘ Pitch-decket lover noget, repoet ikke viser:\n");
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`✔ ${result.evidence.length} bevis-linjer peger på kommandoer og filer, der findes`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
