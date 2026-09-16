#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createAgentRuntime } from "./runtime.mjs";
import { createPdpClient, createGatewayClient, createMemoryAuditLog } from "./clients.mjs";

function parseArgs(argv) {
  const args = { pdp: "http://127.0.0.1:8181/v1/data/platform/ops/decision", gateway: "http://127.0.0.1:8282/v1/chat/completions" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--task") args.task = argv[++i];
    else if (a === "--pdp") args.pdp = argv[++i];
    else if (a === "--gateway") args.gateway = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

/** Standardexecutorer. Hvert verbum kalder kun det, det er deklareret til. */
function buildExecutors(agentRef) {
  return {
    "observe.read": async () => ({ summary: "læst" }),
    "observe.correlate": async () => ({ summary: "korreleret" }),
    diagnose: async () => ({ summary: "diagnosticeret" }),
    propose: async () => ({ summary: "foreslået" }),
    "upgrade.dry-run": async ({ gateway, ...action }) => {
      // Modelkald går gennem gatewayen — aldrig direkte til en leverandør.
      const reply = gateway
        ? await gateway.complete({ agentRef, model: "claude-sonnet", messages: [{ role: "user", content: `dry-run ${action.target}` }] })
        : { text: "ingen gateway", tokens: 0, costEur: 0 };
      return { summary: "dry-run ren", tokens: reply.tokens, costEur: reply.costEur };
    },
    health: async () => ({ summary: "ok" }),
    backup: async () => ({ summary: "backup taget" }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.manifest || !args.task) {
    console.log("Brug: node runtime/src/cli.mjs --manifest <agent.json> --task <task.json> [--pdp url] [--gateway url]");
    return;
  }
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
  const task = JSON.parse(readFileSync(args.task, "utf8"));

  const runtime = createAgentRuntime({
    manifest,
    pdp: createPdpClient({ endpoint: args.pdp }),
    auditLog: createMemoryAuditLog(),
    gateway: createGatewayClient({ endpoint: args.gateway }),
    executors: buildExecutors(manifest.metadata.name),
  });

  const result = await runtime.runTask(task);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
