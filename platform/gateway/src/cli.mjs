#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway } from "./gateway.mjs";
import { createEchoProvider } from "./provider.mjs";
import { createOpenAiCompatibleProvider } from "./providers/openai-compatible.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    port: 8282,
    routes: resolve(here, "..", "routes.json"),
    provider: process.env.MODEL_PROVIDER_BASE_URL ? "openai-compatible" : "echo",
    baseUrl: process.env.MODEL_PROVIDER_BASE_URL ?? null,
    apiKey: process.env.MODEL_PROVIDER_API_KEY ?? null,
    providerName: process.env.MODEL_PROVIDER_NAME ?? "openai-compatible",
    db: process.env.GATEWAY_DB_PATH ?? null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--routes") args.routes = argv[++i];
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--api-key") args.apiKey = argv[++i];
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

async function buildStores(dbPath) {
  if (!dbPath) return { budgetStore: null, callStore: null };
  const { openDatabase } = await import("../../persistence/src/db.mjs");
  const { createMigrator } = await import("../../persistence/src/migrations.mjs");
  const { createSqliteBudgetStore } = await import("../../persistence/src/adapters/budgets.mjs");
  const { createSqliteGatewayCallStore } = await import("../../persistence/src/adapters/gateway-calls.mjs");
  const db = openDatabase({ path: dbPath });
  createMigrator({ db }).apply();
  return { budgetStore: createSqliteBudgetStore({ db }), callStore: createSqliteGatewayCallStore({ db }) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Brug: node gateway/src/cli.mjs [--port 8282] [--routes fil] [--provider echo|openai-compatible]
       [--base-url https://api.openai.com/v1] [--api-key KEY] [--db gateway.sqlite]

Miljø:
  MODEL_PROVIDER_BASE_URL   aktiverer den rigtige OpenAI-kompatible adapter
  MODEL_PROVIDER_API_KEY    leverandørnøgle (læses aldrig fra routes.json)
  GATEWAY_DB_PATH           holdbar budget-/idempotensdatabase`);
    return;
  }
  const config = JSON.parse(readFileSync(args.routes, "utf8"));
  const { budgetStore, callStore } = await buildStores(args.db);

  let provider;
  if (args.provider === "openai-compatible") {
    if (!args.baseUrl) throw new Error("openai-compatible kræver --base-url eller MODEL_PROVIDER_BASE_URL");
    provider = createOpenAiCompatibleProvider({ baseUrl: args.baseUrl, apiKey: args.apiKey, providerName: args.providerName });
  } else if (args.provider === "echo") {
    provider = createEchoProvider();
  } else {
    throw new Error(`ukendt provider '${args.provider}'`);
  }

  const gateway = createGateway({
    routes: config.routes,
    provider,
    budgetStore,
    callStore,
    // Kun metadata logges; rå samtaleindhold forlader aldrig gatewayen.
    onCall: (call) => console.log(JSON.stringify(call)),
  });
  const port = await gateway.listen(args.port);
  console.log(`AI-gateway lytter på http://127.0.0.1:${port}`);
  console.log(`  provider: ${args.provider}${args.baseUrl ? ` (${args.baseUrl})` : ""}`);
  console.log(`  ${gateway.enabled.length} routes — direkte leverandørkald er forbudt`);
  console.log(`  budget: ${budgetStore ? "holdbar (sqlite)" : "in-memory"}`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
