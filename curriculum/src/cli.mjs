#!/usr/bin/env node
/**
 * 4.1 — CLI for ejer-curriculum.
 *
 *   node curriculum/src/cli.mjs check                 # validér curriculum + scenarier
 *   node curriculum/src/cli.mjs render                # vis moduler og scenarier
 *   node curriculum/src/cli.mjs complete --subject S --module a --module b
 *   node curriculum/src/cli.mjs render-completion     # vis et eksempel på et CloudEvent
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { complete, loadCurriculum, validateCurriculum } from "./curriculum.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

export function runValidation(root = repoRoot) {
  const { ajv } = buildAjv();
  const curriculum = loadCurriculum(root);
  const result = validateCurriculum(curriculum, {
    root,
    ajv,
    validateCurriculumSchema: (data) => validate(ajv, SCHEMA_IDS.curriculum, data),
    validateApproval: (data) => validate(ajv, SCHEMA_IDS.approvalRequest, data),
  });
  const problems = [...result.problems];

  // Gennemførelses-events skal selv være gyldige CloudEvents.
  const moduleIds = curriculum.modules.map((m) => m.id);
  const events = complete({ subject: "oidc|self-test", moduleIds, at: "2025-09-01T12:00:00Z" });
  for (const event of events) {
    const { ok, errors } = validate(ajv, SCHEMA_IDS.cloudEvent, event);
    if (!ok) problems.push(`completion-event for '${event.data.moduleId}': ${errors[0]?.message ?? "ugyldigt"}`);
  }

  return { ok: problems.length === 0, problems, curriculum, scenarios: result.scenarios };
}

function parseArgs(argv) {
  const args = { command: argv[0], subject: null, modules: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--subject") args.subject = argv[++i];
    else if (a === "--module") args.modules.push(argv[++i]);
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return args;
}

const HELP = `Brug: node curriculum/src/cli.mjs <kommando>

Kommandøer:
  check                         validér curriculum, scenarier og completion-events
  render                        vis moduler og scenarier
  complete --subject S --module a [--module b]
                                udskriv gennemførelses-events som JSON
  render-completion             vis et eksempel på et CloudEvent
`;

function render(curriculum) {
  const lines = [`Curriculum ${curriculum.metadata.name}@${curriculum.metadata.version}`];
  for (const module of curriculum.modules) {
    lines.push("", `${module.id} — ${module.title}`, `  ${module.objective}`);
    for (const scenario of module.scenarios) {
      lines.push(`    [${scenario.expectedVerdict}] ${scenario.id}: ${scenario.title}`);
    }
  }
  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (!args.command || args.command === "--help" || args.command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    if (args.command === "check") {
      const { curriculum, scenarios } = runValidation();
      console.log(`✔ Curriculum ${curriculum.metadata.name}@${curriculum.metadata.version}`);
      console.log(`  ${scenarios.length} scenarier, heraf ${scenarios.filter((s) => s.scenario.mustReject).length} der skal afvises`);
    } else if (args.command === "render") {
      console.log(render(loadCurriculum()));
    } else if (args.command === "complete") {
      const events = complete({ subject: args.subject, moduleIds: args.modules });
      process.stdout.write(events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    } else if (args.command === "render-completion") {
      const moduleIds = loadCurriculum().modules.map((m) => m.id);
      const [event] = complete({ subject: "oidc|anna.andersen", moduleIds, at: "2025-09-01T12:00:00Z" });
      console.log(JSON.stringify(event, null, 2));
    } else {
      console.error(`Ukendt kommando: ${args.command}\n\n${HELP}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
