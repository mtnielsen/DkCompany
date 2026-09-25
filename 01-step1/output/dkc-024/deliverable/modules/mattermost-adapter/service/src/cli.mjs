#!/usr/bin/env node
import { createMattermostAdapter } from "./server.mjs";
import { createMattermostClient } from "./mattermost.mjs";
import { createPdpClient } from "./pdp-client.mjs";
import { createSpiffeAuthenticator, createAuthenticator } from "./auth.mjs";

function parseArgs(argv) {
  const args = { port: 8090, pdp: "http://127.0.0.1:8181/v1/data/platform/ops/decision", mattermost: "http://mattermost:8065", token: "change-me", trustDomain: "platform.example.org", environment: "dev", profile: "production", trustedProxies: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--pdp") args.pdp = argv[++i];
    else if (a === "--mattermost") args.mattermost = argv[++i];
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--trust-domain") args.trustDomain = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--trusted-proxy") args.trustedProxies.push(argv[++i]);
    else if (a === "--proxy-secret") args.proxySecret = argv[++i];
    else if (a === "--demo") args.demo = argv[++i];
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Brug: node modules/mattermost-adapter/service/src/cli.mjs [--port 8090] [--mattermost url] [--pdp url]");
    return;
  }
  const adapter = createMattermostAdapter({
    authenticate: createAuthenticator([
      createSpiffeAuthenticator({
        trustDomain: args.trustDomain,
        profile: args.profile,
        trustedProxies: args.trustedProxies,
        proxySecret: args.proxySecret,
        demo: args.profile === "test" && args.demo ? { enabled: true, id: args.demo } : undefined,
      }),
    ]),
    pdp: createPdpClient({ endpoint: args.pdp, failMode: "closed" }),
    client: createMattermostClient({ baseUrl: args.mattermost, token: args.token }),
    environment: args.environment,
    profile: args.profile,
    onEvent: (e) => console.log(JSON.stringify(e)),
  });
  const port = await adapter.listen(args.port);
  console.log(`mattermost-adapter lytter på http://127.0.0.1:${port}`);
  console.log(`  upstream: ${args.mattermost} (uændret)`);
  console.log(`  PDP: ${args.pdp} (fail-closed)`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
