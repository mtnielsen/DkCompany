#!/usr/bin/env node
/**
 * DKC-040 — CLI for den holdbare beskedudveksling.
 *
 *   node jobs/src/messaging-cli.mjs check
 *
 * Kontrollerer at den kanoniske topologi (`jobs/messaging.json`) og
 * kontrakteksemplerne validerer med både skema og beslutningssemantik, og at
 * eksemplet er i trit med den kanoniske kilde. En `check` er en kontraktkontrol,
 * ikke et bevis på en kørende broker.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMessagingTopology, validateOutboxRecord } from "../../conformance/src/messaging.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runMessagingCheck(root = repoRoot) {
  const problems = [];
  const plan = readJson(join(root, "jobs", "messaging.json"));
  const validation = validateMessagingTopology(plan);
  for (const e of validation.errors) problems.push(`jobs/messaging.json${e.path}: ${e.message}`);

  const examplePath = join(root, "contracts", "examples", "messaging-topology.example.json");
  const example = readJson(examplePath);
  const exampleValidation = validateMessagingTopology(example);
  for (const e of exampleValidation.errors) problems.push(`messaging-topology.example.json${e.path}: ${e.message}`);
  if (JSON.stringify(example) !== JSON.stringify(plan)) {
    problems.push("messaging-topology.example.json er ude af trit med jobs/messaging.json");
  }

  const outboxPath = join(root, "contracts", "examples", "outbox-record.example.json");
  const outbox = readJson(outboxPath);
  const outboxValidation = validateOutboxRecord(outbox);
  for (const e of outboxValidation.errors) problems.push(`outbox-record.example.json${e.path}: ${e.message}`);

  return { ok: problems.length === 0, problems, plan };
}

function main() {
  const command = process.argv[2];
  if (command === "check") {
    const result = runMessagingCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Beskedkontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Beskedtopologi, outbox-/inbox-kontrakt og rækkefølgepolitik er konsistente");
    console.log("✔ En rigtig broker og en målt leverance er fortsat NOT RUN (integration-message-broker)");
    return;
  }
  console.error("Brug: node jobs/src/messaging-cli.mjs check");
  process.exit(2);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) main();
