#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS, repoRoot, describeErrors } from "./schemas.mjs";
import { loadModule, resolveModuleDir, ManifestError } from "./manifest.mjs";
import { CHECKS } from "./checks/index.mjs";
import { createReport, addCheck, finalize, formatText, toBadge, exitCode } from "./report.mjs";

function parseArgs(argv) {
  const args = { module: null, all: false, json: false, offline: true, report: null, badge: null, exclude: [], expectFail: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--json") args.json = true;
    else if (a === "--online") args.offline = false;
    else if (a === "--offline") args.offline = true;
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--badge") args.badge = argv[++i];
    else if (a === "--exclude") args.exclude.push(argv[++i]);
    else if (a === "--expect-fail") args.expectFail = true;
    else if (a === "--module" || a === "-m") args.module = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-")) args.module = a;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return args;
}

const HELP = `Brug: make conform MODULE=<navn>   eller   node src/cli.mjs [modul]

Kører konformanssuiten mod et modul og udskriver en pass/fail-rapport.

Argumenter:
  <modul>              modulnavn under /modules eller sti til modulmappe
  --all                kør mod alle moduler under /modules
  --exclude <navn>     spring modul over (kan gentages)
  --expect-fail        exit 0 hvis modulet fejler (negativ fixture)
  --json               udskriv rapport som JSON
  --online             tillad netværksprobes (default: offline)
  --report <sti>       skriv JSON-rapport til sti
  --badge <sti>        skriv shields.io-badge-JSON til sti
  -h, --help           vis denne hjælp
`;

export function runModule(moduleRef, { offline, ajv }) {
  const moduleDir = resolveModuleDir(repoRoot, moduleRef);
  const { manifest } = loadModule(moduleDir);
  const report = createReport({
    module: manifest?.metadata?.name ?? moduleRef,
    version: manifest?.metadata?.version ?? "?",
  });
  const ctx = { moduleDir, manifest, ajv, offline, validate: (schemaId, data) => validate(ajv, schemaId, data), SCHEMA_IDS, describeErrors, repoRoot };
  for (const check of CHECKS) {
    let result;
    try {
      result = check.run(ctx);
    } catch (err) {
      result = { status: "fail", detail: `check kastede: ${err.message}`, messages: [] };
    }
    addCheck(report, { id: check.id, title: check.title, ...result });
  }
  return finalize(report);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  const { ajv } = buildAjv();

  let refs;
  if (args.all) {
    const { readdirSync, existsSync } = await import("node:fs");
    const modulesDir = join(repoRoot, "modules");
    refs = existsSync(modulesDir)
      ? readdirSync(modulesDir).filter((d) => existsSync(join(modulesDir, d, "module-manifest.json")) && !args.exclude.includes(d))
      : [];
    if (refs.length === 0) {
      console.error("Ingen moduler fundet under /modules");
      process.exit(2);
    }
  } else if (args.module) {
    refs = [args.module];
  } else {
    console.error(HELP);
    process.exit(2);
  }

  const reports = [];
  for (const ref of refs) {
    try {
      reports.push(runModule(ref, { offline: args.offline, ajv }));
    } catch (err) {
      if (err instanceof ManifestError) {
        console.error(`✘ ${ref}: ${err.message}`);
        process.exitCode = 2;
        continue;
      }
      throw err;
    }
  }

  const aggregate = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: reports.every((r) => r.status === "pass") ? "pass" : "fail",
    reports,
  };

  if (args.json) {
    console.log(JSON.stringify(aggregate, null, 2));
  } else {
    for (const r of reports) {
      console.log(formatText(r));
      console.log("");
    }
    if (reports.length > 1) {
      console.log(`Samlet: ${aggregate.status.toUpperCase()}`);
    }
  }

  if (args.report) {
    mkdirSync(dirname(args.report), { recursive: true });
    writeFileSync(args.report, JSON.stringify(aggregate, null, 2));
  }
  if (args.badge) {
    mkdirSync(dirname(args.badge), { recursive: true });
    const badge = reports.length === 1
      ? toBadge(reports[0])
      : {
          schemaVersion: 1,
          label: "conformance",
          message: `${reports.filter((r) => r.status === "pass").length}/${reports.length} modules`,
          color: aggregate.status === "pass" ? "brightgreen" : "red",
        };
    writeFileSync(args.badge, JSON.stringify(badge, null, 2));
  }

  const failed = reports.filter((r) => r.status !== "pass");
  if (args.expectFail) {
    if (failed.length === 0) {
      console.error("✘ --expect-fail: modulet bestod, men skulle fejle");
      process.exitCode = 1;
    } else {
      console.log(`✔ Negativ fixture fejlede som forventet (${failed.length} modul(er))`);
      process.exitCode = 0;
    }
  } else if (failed.length) {
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(2);
  });
}
