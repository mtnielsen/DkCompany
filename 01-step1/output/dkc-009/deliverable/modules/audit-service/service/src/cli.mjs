#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createAuditService } from "./server.mjs";
import { createPdpClient } from "./pdp-client.mjs";
import { createOidcAuthenticator, createSpiffeAuthenticator, createAuthenticator } from "./auth.mjs";
import { openAuditWriter } from "../../../../persistence/src/audit-roles.mjs";

function parseArgs(argv) {
  const args = { port: 8080, pdp: "http://127.0.0.1:8181/v1/data/platform/ops/decision", environment: "dev", profile: "production", trustDomain: "platform.example.org", trustedProxies: [], source: "urn:platform:module:audit-service" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--pdp") args.pdp = argv[++i];
    else if (a === "--environment") args.environment = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--trust-domain") args.trustDomain = argv[++i];
    else if (a === "--trusted-proxy") args.trustedProxies.push(argv[++i]);
    else if (a === "--proxy-secret") args.proxySecret = argv[++i];
    else if (a === "--demo") args.demo = argv[++i];
    else if (a === "--tenant") args.tenant = argv[++i];
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--issuer") args.issuer = argv[++i];
    else if (a === "--audience") args.audience = argv[++i];
    else if (a === "--jwks") args.jwks = argv[++i];
    else if (a === "--audit-dir") args.auditDir = argv[++i];
    else if (a === "--anchor-dir") args.anchorDir = argv[++i];
    else if (a === "--anchor-secret") args.anchorSecret = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

const HELP = `Brug: node modules/audit-service/service/src/cli.mjs [flag]

Referencemodul A (evidens-/audit-service). Starter HTTP-tjenesten.

Flag:
  --port <8080>              lytteport
  --pdp <url>                PDP-endpoint (fail-closed)
  --environment <dev>        miljø
  --trust-domain <domæne>    SPIFFE trust domain
  --issuer <url>             OIDC issuer (kræver --jwks)
  --audience <aud>           OIDC audience
  --jwks <fil>               JWK-set til OIDC-verifikation
  --audit-dir <mappe>        brug holdbar audit-database (DKC-009) i mappen
  --anchor-dir <mappe>       mappe til eksternt checkpoint (kræver --audit-dir)
  --anchor-secret <nøgle>    HMAC-nøgle til checkpoint (kræver --anchor-dir)
  --help
`;

function buildAuthenticator(args) {
  const chain = [];
  if (args.jwks && args.issuer) {
    const jwks = JSON.parse(readFileSync(args.jwks, "utf8"));
    chain.push(createOidcAuthenticator({ issuer: args.issuer, audience: args.audience, jwks, expectedTenant: args.tenant }));
  }
  chain.push(
    createSpiffeAuthenticator({
      trustDomain: args.trustDomain,
      profile: args.profile,
      trustedProxies: args.trustedProxies,
      proxySecret: args.proxySecret,
      demo: args.profile === "test" && args.demo ? { enabled: true, id: args.demo } : undefined,
    })
  );
  return createAuthenticator(chain);
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

  // DKC-009: med --audit-dir bruges den holdbare action-journal og den
  // hash-kædede log i databasen i stedet for in-memory-loggen.
  const durable = args.auditDir
    ? openAuditWriter({ dataDir: args.auditDir, anchorDir: args.anchorDir ?? null, secret: args.anchorSecret ?? null })
    : null;

  const service = createAuditService({
    authenticate: buildAuthenticator(args),
    pdp: createPdpClient({ endpoint: args.pdp, failMode: "closed" }),
    environment: args.environment,
    source: args.source,
    ...(durable ? { log: durable.log, journal: durable.journal } : {}),
    onEvent: (e) => console.log(JSON.stringify(e)),
  });

  // Seed lidt persondata, så privacy-verberne har noget at arbejde med i dev.
  service.subjects.add({ tenantId: args.tenant ?? "acme", subjects: [{ type: "email", value: "kunde@example.org" }], dataCategories: ["personal"], data: { plan: "gold" } });
  service.subjects.add({ tenantId: args.tenant ?? "acme", subjects: [{ type: "customer-id", value: "C-998877" }], dataCategories: ["pseudonymised"], data: { tickets: 3 } });

  const port = await service.listen(args.port);
  console.log(`${args.source} lytter på http://127.0.0.1:${port}`);
  console.log(`  PDP: ${args.pdp} (fail-closed)`);
  console.log(`  audit-events: ${durable ? `holdbar (${args.auditDir})` : "hash-kædet in-memory"}`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
