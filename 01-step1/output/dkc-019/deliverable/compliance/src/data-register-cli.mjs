#!/usr/bin/env node
/**
 * DKC-019 — CLI for dataregisteret.
 *
 *   node compliance/src/data-register-cli.mjs render   # Markdown til stdout
 *   node compliance/src/data-register-cli.mjs write    # skriv docs/compliance/data-register.md
 *   node compliance/src/data-register-cli.mjs check    # fejl hvis dokumentet er ude af trit
 *   node compliance/src/data-register-cli.mjs verify   # validér + krydsreferér mod moduler/routes
 *
 * Den kanoniske kilde er compliance/data-register.json. Den valideres mod
 * kontrakten, krydsrefereres mod de rigtige moduler og routes og må ikke have
 * aktive blockere på en godkendt post, før noget skrives.
 */
import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import { loadRegister, renderMarkdown, check, checkRepoReferences, blockerRows, outputPath, registerPath, repoRoot } from "./data-register.mjs";

const HELP = `Brug: node compliance/src/data-register-cli.mjs <kommando>

Kommandøer:
  render   skriv Markdown til stdout
  write    skriv docs/compliance/data-register.md
  check    fejl hvis dokumentet ikke matcher registeret
  verify   validér registeret og krydsreferencer mod moduler og routes
`;

function verify() {
  const register = loadRegister();
  const problems = checkRepoReferences(register);
  if (problems.length) {
    throw new Error("Dataregisteret krydsrefererer ikke korrekt:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  }
  const blockers = blockerRows(register);
  const approvedWithBlocker = register.entries.filter((e) => e.status === "approved" && blockerRows({ entries: [e] }).length);
  if (approvedWithBlocker.length) {
    throw new Error(`Godkendte poster med aktive blockere: ${approvedWithBlocker.map((e) => e.id).join(", ")}`);
  }
  return { register, problems, blockers };
}

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (command === "render") {
      process.stdout.write(renderMarkdown(loadRegister()));
    } else if (command === "write") {
      writeFileSync(outputPath, renderMarkdown(loadRegister()));
      console.log(`✔ Dataregister skrevet: ${relative(repoRoot, outputPath)}`);
    } else if (command === "check") {
      check();
      console.log(`✔ ${relative(repoRoot, outputPath)} matcher ${relative(repoRoot, registerPath)}`);
    } else if (command === "verify") {
      const { register, blockers } = verify();
      console.log(`✔ Dataregister valideret: ${register.entries.length} poster, ${register.subprocessors.length} subprocessorer`);
      console.log(`✔ ${blockers.length} aktive blocker(e) markeret for persondata`);
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
