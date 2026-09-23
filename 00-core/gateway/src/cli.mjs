#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway } from "./gateway.mjs";
import { createEchoProvider } from "./provider.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { port: 8282, routes: resolve(here, "..", "routes.json") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--routes") args.routes = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Brug: node gateway/src/cli.mjs [--port 8282] [--routes fil]");
    return;
  }
  const config = JSON.parse(readFileSync(args.routes, "utf8"));
  const gateway = createGateway({
    routes: config.routes,
    provider: createEchoProvider(),
    onCall: (call) => console.log(JSON.stringify(call)),
  });
  const port = await gateway.listen(args.port);
  console.log(`AI-gateway lytter på http://127.0.0.1:${port}`);
  console.log(`  ${gateway.enabled.length} routes — direkte leverandørkald er forbudt`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
