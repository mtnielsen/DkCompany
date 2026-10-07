#!/usr/bin/env node
/**
 * DKC-021 — CLI for slette- og tilbageholdelsesreglerne.
 *
 *   node retention/src/cli.mjs render    # Markdown til stdout
 *   node retention/src/cli.mjs write     # skriv docs/compliance/deletion-coverage.md
 *   node retention/src/cli.mjs check     # fejl hvis dokumentet er ude af trit
 *   node retention/src/cli.mjs demo      # kør et fuldt sletteforløb på den rigtige stak
 *   node retention/src/cli.mjs explain <surface-id>  # vis dækningen for en flade
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { loadPolicy, outputPath, repoRoot } from "./registry.mjs";
import { renderMarkdown } from "./render.mjs";
import { surfaceById } from "./policy.mjs";
import { runDemo } from "./demo.mjs";

const HELP = `Brug: node retention/src/cli.mjs <kommando>

Kommandøer:
  render              skriv Markdown til stdout
  write               skriv docs/compliance/deletion-coverage.md
  check               fejl hvis dokumentet ikke matcher politikken
  demo                kør et fuldt sletteforløb og vis kvitteringen
  explain <flade-id>  forklar dækningen for en flade
`;

export function check() {
  const expected = renderMarkdown(loadPolicy());
  if (!existsSync(outputPath)) throw new Error(`${relative(repoRoot, outputPath)} mangler. Kør 'make retention-write'.`);
  const actual = readFileSync(outputPath, "utf8");
  if (actual !== expected) throw new Error(`${relative(repoRoot, outputPath)} er ude af trit med politikken. Kør 'make retention-write'.`);
}

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "render") {
      process.stdout.write(renderMarkdown(loadPolicy()));
    } else if (command === "write") {
      writeFileSync(outputPath, renderMarkdown(loadPolicy()));
      console.log(`✔ Dækningstabel skrevet: ${relative(repoRoot, outputPath)}`);
    } else if (command === "check") {
      check();
      console.log(`✔ ${relative(repoRoot, outputPath)} matcher slettepolitikken`);
    } else if (command === "demo") {
      const demo = runDemo();
      try {
        console.log(JSON.stringify({ receipt: demo.receipt, holds: demo.holds, restore: demo.restore }, null, 2));
      } finally {
        demo.cleanup();
      }
    } else if (command === "explain") {
      const id = process.argv[3];
      if (!id) throw new Error("explain kræver et flade-id");
      const surface = surfaceById(loadPolicy(), id);
      if (!surface) {
        console.log(`${id}: ukendt flade`);
        return;
      }
      console.log(`${surface.id} (${surface.kind}) — dækning: ${surface.coverage}${surface.external ? " (ekstern)" : ""}`);
      console.log(`  klasser: ${surface.dataClasses.join(", ")}`);
      console.log(`  mekanisme: ${surface.deleteMechanism}`);
      console.log(`  retention: ${surface.retentionDays} dage, udløser: ${surface.trigger}`);
      if (surface.reason) console.log(`  begrundelse: ${surface.reason}`);
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
