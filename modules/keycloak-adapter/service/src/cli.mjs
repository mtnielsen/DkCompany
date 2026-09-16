#!/usr/bin/env node
import { createKeycloakAdapter } from "./server.mjs";
import { createKeycloakClient } from "./keycloak.mjs";
import { createPdpClient } from "./pdp-client.mjs";
import { createSpiffeAuthenticator, createAuthenticator } from "./auth.mjs";

function parseArgs(argv) {
  const args = {
    port: 8091,
    pdp: "http://127.0.0.1:8181/v1/data/platform/ops/decision",
    keycloak: "http://keycloak:8080",
    realm: "platform",
    token: "change-me",
    trustDomain: "platform.example.org",
    environment: "dev",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--pdp") args.pdp = argv[++i];
    else if (a === "--keycloak") args.keycloak = argv[++i];
    else if (a === "--realm") args.realm = argv[++i];
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--trust-domain") args.trustDomain = argv[++i];
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Brug: node modules/keycloak-adapter/service/src/cli.mjs [--port 8091] [--keycloak url] [--realm platform] [--pdp url]");
    return;
  }
  const adapter = createKeycloakAdapter({
    authenticate: createAuthenticator([createSpiffeAuthenticator({ trustDomain: args.trustDomain })]),
    pdp: createPdpClient({ endpoint: args.pdp, failMode: "closed" }),
    client: createKeycloakClient({ baseUrl: args.keycloak, realm: args.realm, token: args.token }),
    environment: args.environment,
    onEvent: (e) => console.log(JSON.stringify(e)),
  });
  const port = await adapter.listen(args.port);
  console.log(`keycloak-adapter lytter på http://127.0.0.1:${port}`);
  console.log(`  upstream: ${args.keycloak}/realms/${args.realm} (uændret)`);
  console.log(`  PDP: ${args.pdp} (fail-closed)`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
