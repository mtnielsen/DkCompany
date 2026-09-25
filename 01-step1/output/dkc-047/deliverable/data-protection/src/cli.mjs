#!/usr/bin/env node
/**
 * DKC-047 — CLI for beskyttede dataklasser.
 *
 *   node data-protection/src/cli.mjs render     # Markdown til stdout
 *   node data-protection/src/cli.mjs write      # skriv docs/compliance/protected-data.md
 *   node data-protection/src/cli.mjs check      # fejl hvis dokumentet er ude af trit
 *   node data-protection/src/cli.mjs explain <target>  # vis beskyttelsen for en target
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy, loadRegister, createProtectedDataGuard, repoRoot } from "./registry.mjs";
import { renderMarkdown } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const outputPath = join(repoRoot, "docs", "compliance", "protected-data.md");

export function check() {
  const expected = renderMarkdown(loadRegister(), loadPolicy());
  if (!existsSync(outputPath)) throw new Error(`${relative(repoRoot, outputPath)} mangler. Kør 'make data-protection-write'.`);
  const actual = readFileSync(outputPath, "utf8");
  if (actual !== expected) throw new Error(`${relative(repoRoot, outputPath)} er ude af trit med registeret. Kør 'make data-protection-write'.`);
}

const HELP = `Brug: node data-protection/src/cli.mjs <kommando>

Kommandøer:
  render           skriv Markdown til stdout
  write            skriv docs/compliance/protected-data.md
  check            fejl hvis dokumentet ikke matcher registeret
  explain <target> forklar beskyttelsen for en target
`;

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "render") {
      process.stdout.write(renderMarkdown(loadRegister(), loadPolicy()));
    } else if (command === "write") {
      writeFileSync(outputPath, renderMarkdown(loadRegister(), loadPolicy()));
      console.log(`✔ Beskyttelsestabel skrevet: ${relative(repoRoot, outputPath)}`);
    } else if (command === "check") {
      check();
      console.log(`✔ ${relative(repoRoot, outputPath)} matcher beskyttelsesregisteret`);
    } else if (command === "explain") {
      const target = process.argv[3];
      if (!target) throw new Error("explain kræver en target");
      const guard = createProtectedDataGuard();
      const record = guard.resolve(target);
      if (!record) {
        console.log(`${target}: ikke beskyttet (ordinary, ingen no-AI-access)`);
        return;
      }
      console.log(`${record.id} — klasse '${record.dataClass}', no-AI-access: ${record.noAiAccess}`);
      console.log(`  pointer: ${record.authoritativePointer}, nøgledomæne: ${record.keyDomain}`);
      console.log(`  lagerhåndhævelse: ${record.storageEnforcement.status} (${record.storageEnforcement.deliveredBy ?? "—"})`);
      console.log(`  AI må: ${(guard.policy.agentOperationMatrix[record.dataClass] ?? []).join(", ") || "intet"}`);
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
