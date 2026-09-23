#!/usr/bin/env node
/**
 * 3.2 — CLI for kontrolmappingen.
 *
 *   node compliance/src/cli.mjs render   # Markdown til stdout
 *   node compliance/src/cli.mjs write    # skriv docs/compliance/mapping.md
 *   node compliance/src/cli.mjs check    # fejl hvis docs er ude af trit med registry
 *
 * Den kanoniske kilde er compliance/control-mapping.json. Den valideres mod
 * kontrakten og krydsrefereres, før noget skrives — en mapping, der peger på et
 * krav, der ikke findes, er værre end ingen mapping.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { findProblems, renderMarkdown } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const registryPath = join(repoRoot, "compliance", "control-mapping.json");
export const outputPath = join(repoRoot, "docs", "compliance", "mapping.md");

export function loadMapping() {
  if (!existsSync(registryPath)) throw new Error(`Mangler ${relative(repoRoot, registryPath)}`);
  const mapping = JSON.parse(readFileSync(registryPath, "utf8"));

  const { ajv } = buildAjv();
  const { ok, errors } = validate(ajv, SCHEMA_IDS.controlMapping, mapping);
  if (!ok) {
    throw new Error(
      "control-mapping.json matcher ikke kontrakten:\n" +
        errors.map((e) => `  ${(e.path || "/").trim()} ${e.message}`).join("\n")
    );
  }
  const problems = findProblems(mapping);
  if (problems.length) {
    throw new Error("Kortlægningen er inkonsistent:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  }
  return mapping;
}

export function check() {
  const expected = renderMarkdown(loadMapping());
  if (!existsSync(outputPath)) {
    throw new Error(`${relative(repoRoot, outputPath)} mangler. Kør 'make compliance-mapping'.`);
  }
  const actual = readFileSync(outputPath, "utf8");
  if (actual !== expected) {
    throw new Error(`${relative(repoRoot, outputPath)} er ude af trit med registry. Kør 'make compliance-mapping'.`);
  }
}

const HELP = `Brug: node compliance/src/cli.mjs <kommando>

Kommandøer:
  render   skriv Markdown til stdout
  write    skriv docs/compliance/mapping.md
  check    fejl hvis docs/compliance/mapping.md ikke matcher registry
`;

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "render") {
      process.stdout.write(renderMarkdown(loadMapping()));
    } else if (command === "write") {
      writeFileSync(outputPath, renderMarkdown(loadMapping()));
      console.log(`✔ Kontrolmapping skrevet: ${relative(repoRoot, outputPath)}`);
    } else if (command === "check") {
      check();
      console.log("✔ docs/compliance/mapping.md matcher compliance/control-mapping.json");
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
