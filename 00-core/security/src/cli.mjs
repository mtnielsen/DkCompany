#!/usr/bin/env node
/**
 * 3.4 — CLI for sikkerhedsfund.
 *
 *   node security/src/cli.mjs render   # normaliseret pakke til stdout
 *   node security/src/cli.mjs write    # skriv security/generated/security-findings.json
 *   node security/src/cli.mjs check    # valider + fejl hvis committede fund er ude af trit
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { buildBundle } from "./ingest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const outputPath = join(repoRoot, "security", "generated", "security-findings.json");

export function loadBundle(root = repoRoot) {
  const bundle = buildBundle({ root });
  const { ajv } = buildAjv();
  const { ok, errors } = validate(ajv, SCHEMA_IDS.securityFindings, bundle);
  if (!ok) {
    throw new Error(
      "SecurityFindings matcher ikke kontrakten:\n" +
        errors.map((e) => `  ${(e.path || "/").trim()} ${e.message}`).join("\n")
    );
  }
  return bundle;
}

export function check(root = repoRoot) {
  const expected = JSON.stringify(loadBundle(root), null, 2) + "\n";
  if (!existsSync(outputPath)) {
    throw new Error(`${relative(repoRoot, outputPath)} mangler. Kør 'make security-ingest'.`);
  }
  if (readFileSync(outputPath, "utf8") !== expected) {
    throw new Error(`${relative(repoRoot, outputPath)} er ude af trit med rå scanningsdata. Kør 'make security-ingest'.`);
  }
}

const HELP = `Brug: node security/src/cli.mjs <kommando>

Kommandøer:
  render   skriv normaliserede fund til stdout
  write    skriv security/generated/security-findings.json
  check    validér og fejl hvis den committede pakke ikke matcher rådata
`;

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "render") {
      process.stdout.write(JSON.stringify(loadBundle(), null, 2) + "\n");
    } else if (command === "write") {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(loadBundle(), null, 2) + "\n");
      console.log(`✔ Sikkerhedsfund skrevet: ${relative(repoRoot, outputPath)}`);
    } else if (command === "check") {
      check();
      console.log("✔ Sikkerhedsfund matcher rådata og kontrakten");
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
