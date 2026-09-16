#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, loadManifests, loadApplications, runVerify } from "./verify.mjs";
import { reconcile, applyDrift } from "./reconcile.mjs";
import { generateChangelog, writeChangelog, unsignedCommits } from "./changelog.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, env: "dev", exclude: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--observed") args.observed = rest[++i];
    else if (a === "--env") args.env = rest[++i];
    else if (a === "--out") args.out = rest[++i];
    else if (a === "--exclude") args.exclude.push(rest[++i]);
    else if (a === "--from") args.from = rest[++i];
    else if (a === "--to") args.to = rest[++i];
    else if (a === "--check") args.check = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

const HELP = `Brug: node gitops/src/cli.mjs <kommando> [flag]

Kommandøer:
  verify                     Kontrollér GitOps-policy-gates
  reconcile [--observed f]   Sammenlign git (ønsket) med observeret tilstand
  drift                      Anvend den simulerede drift og bevis at den opdages
  changelog [--out f|--check] Udled maskinlæsbar change log fra git

Flag:
  --env <dev>       miljø (default: dev)
  --exclude <modul> spring modul over (kan gentages)
  --from/--to <rev> begræns change log til et range
`;

function printReport(report) {
  for (const c of report.checks) {
    const icon = c.status === "pass" ? "✔" : c.status === "skip" ? "•" : "✘";
    console.log(`  ${icon} ${c.id}  ${c.title}${c.detail ? ` — ${c.detail}` : ""}`);
    for (const m of c.messages) console.log(`      - ${m}`);
  }
  console.log(`\n${report.status === "pass" ? "✔ GitOps-gates bestået" : "✘ GitOps-gates fejlede"} (${report.summary.pass}/${report.summary.total})`);
}

function commandVerify(args) {
  const report = runVerify(repoRoot, { excludeModules: args.exclude });
  printReport(report);
  if (report.status !== "pass") process.exit(1);
}

function loadObserved(path) {
  return JSON.parse(readFileSync(path, "utf8")).resources;
}

function commandReconcile(args) {
  const desired = loadManifests(repoRoot, args.env).map((m) => m.data);
  const observed = args.observed ? loadObserved(args.observed) : structuredClone(desired);
  const result = reconcile(desired, observed);
  if (result.inSync) {
    console.log(`✔ Klyngen er i sync med git (${result.desiredCount} ressourcer)`);
    return;
  }
  console.log(`✘ Drift fundet: ${result.actions.length} handlinger`);
  for (const a of result.actions) console.log(`  ${a.op.padEnd(7)} ${a.key} — ${a.detail}`);
  console.log("\nReconcile fører klyngen tilbage til git-tilstanden (selfHeal + prune).");
  process.exit(1);
}

function commandDrift() {
  const desired = loadManifests(repoRoot, "dev").map((m) => m.data);
  const driftSpec = JSON.parse(readFileSync(join(repoRoot, "gitops", "observed", "dev-drift.json"), "utf8"));
  const observed = applyDrift(desired, driftSpec);
  const result = reconcile(desired, observed);
  console.log(`Simuleret drift (${driftSpec.changes.length} ændringer uden om git):`);
  for (const a of result.actions) console.log(`  ${a.op.padEnd(7)} ${a.key} — ${a.detail}`);
  if (result.inSync) {
    console.error("\n✘ Drift blev IKKE opdaget — det er en fejl i reconcilen");
    process.exit(1);
  }
  console.log(`\n✔ ${result.actions.length} drift-handlinger opdaget og ville blive ført tilbage til git`);
}

function commandChangelog(args) {
  const entries = generateChangelog({ cwd: repoRoot, from: args.from, to: args.to });
  const unsigned = unsignedCommits(entries);
  if (args.check) {
    console.log(`✔ ${entries.length} commits i change loggen`);
    if (unsigned.length) {
      console.error(`✘ ${unsigned.length} commits mangler sign-off:`);
      for (const c of unsigned) console.error(`  - ${c.hash.slice(0, 12)} ${c.subject}`);
      process.exit(1);
    }
    console.log("✔ Alle commits er DCO-signeret");
    return;
  }
  if (args.out) {
    writeChangelog(args.out, entries);
    console.log(`✔ Change log skrevet: ${args.out} (${entries.length} commits, ${unsigned.length} usignerede)`);
  } else {
    process.stdout.write(entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help || !args.command) {
    console.log(HELP);
    return;
  }
  switch (args.command) {
    case "verify":
      return commandVerify(args);
    case "reconcile":
      return commandReconcile(args);
    case "drift":
      return commandDrift();
    case "changelog":
      return commandChangelog(args);
    default:
      console.error(`Ukendt kommando: ${args.command}\n\n${HELP}`);
      process.exit(2);
  }
}

main();
