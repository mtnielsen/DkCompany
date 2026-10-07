#!/usr/bin/env node
/**
 * DKC-004 — kommandolinje for approval-servicen.
 *
 * Starter HTTP-tjenesten med et filbaseret lager og en tamper-evident
 * audit-log, så godkendelser overlever genstart, og et brud på historikken
 * opdages ved start (fail-closed).
 *
 *   node approvals/src/cli.mjs --port 8282 --data-dir .approval-data \
 *     --issuer https://idp.example.org --audience platform --jwks jwks.json \
 *     --ledger-secret "$APPROVAL_LEDGER_SECRET" --training training.json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApprovalService } from "./approval-service.mjs";
import { createFileStore } from "./store.mjs";
import { createApprovalLedger } from "./ledger.mjs";
import { createPlatformAuthenticator } from "../../identity/src/identity.mjs";

function parseArgs(argv) {
  const args = {
    port: 8282,
    dataDir: ".approval-data",
    issuer: null,
    audience: null,
    jwks: null,
    trustDomain: null,
    proxySecret: null,
    ledgerSecret: null,
    training: null,
    profile: "production",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--data-dir") args.dataDir = argv[++i];
    else if (a === "--issuer") args.issuer = argv[++i];
    else if (a === "--audience") args.audience = argv[++i];
    else if (a === "--jwks") args.jwks = argv[++i];
    else if (a === "--trust-domain") args.trustDomain = argv[++i];
    else if (a === "--proxy-secret") args.proxySecret = argv[++i];
    else if (a === "--ledger-secret") args.ledgerSecret = argv[++i];
    else if (a === "--training") args.training = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

const HELP = `Brug: node approvals/src/cli.mjs [flag]

Starter approval-servicen med filbaseret lager og tamper-evident audit-log.

Flag:
  --port <8282>            lytteport
  --data-dir <.approval-data>  mappe til lager + audit-log
  --issuer <url>           OIDC issuer (kræver --jwks)
  --audience <aud>         OIDC audience
  --jwks <fil>             JWK-set til OIDC-verifikation
  --trust-domain <domæne>  SPIFFE trust domain
  --proxy-secret <secret>  HMAC-hemmelighed for betroet proxy
  --ledger-secret <secret> HMAC-hemmelighed for audit-loggen (anbefalet)
  --training <fil>         JSON: { "subject": ["modul", ...] } (serverstyret træning)
  --help
`;

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function buildAuthenticator(args) {
  const oidc = args.jwks && args.issuer ? { jwks: loadJson(args.jwks), issuer: args.issuer, audience: args.audience } : undefined;
  const workload =
    args.trustDomain || args.proxySecret
      ? { trustDomain: args.trustDomain ?? undefined, proxySecret: args.proxySecret ?? undefined }
      : undefined;
  return createPlatformAuthenticator({ oidc, workload, profile: args.profile });
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

  const store = createFileStore({ dir: join(args.dataDir, "requests") });
  const ledger = createApprovalLedger({ path: join(args.dataDir, "approval-ledger.jsonl"), secret: args.ledgerSecret });
  const training = args.training ? loadJson(args.training) : {};
  const trainingRegistry = (subject) => training[subject] ?? [];

  const service = createApprovalService({
    store,
    ledger,
    trainingRegistry,
    authenticator: buildAuthenticator(args),
  });

  const port = await service.listen(args.port);
  console.log(`approval-service lytter på http://127.0.0.1:${port}`);
  console.log(`  lager: ${store.dir}`);
  console.log(`  audit: ${ledger.path} (${ledger.verifyChain().ok ? "kæde OK" : "KÆDE BRUDT"})`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
