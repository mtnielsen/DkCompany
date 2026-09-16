#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defaultBundleDir, defaultTrustedKeys, loadTrustedKeys, loadBundle, createPdp, repoRoot } from "./pdp.mjs";
import { generateSigningKey, signBundle, verifyBundleSignature } from "./crypto.mjs";

const keysDir = join(repoRoot, "policy", "keys");
const signingKeyPath = join(keysDir, "signing-key.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, bundle: defaultBundleDir, trusted: defaultTrustedKeys, keyId: "platform-demo" };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--bundle") args.bundle = rest[++i];
    else if (a === "--trusted") args.trusted = rest[++i];
    else if (a === "--input") args.input = rest[++i];
    else if (a === "--port") args.port = Number(rest[++i]);
    else if (a === "--key-id") args.keyId = rest[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

const HELP = `Brug: node policy/pdp/src/cli.mjs <kommando> [flag]

Kommandøer:
  verify                 Verificér bundle-signaturen mod betroede nøgler
  decide --input <fil>   Træf én beslutning på et policy-input (JSON)
  serve [--port n]       Start PDP'en som HTTP-tjeneste
  keygen                 Generér Ed25519-signeringsnøgle og tilføj til trusted.json
  sign                   Signér bundle med den lokale signeringsnøgle

Flag:
  --bundle <sti>   bundle-mappe (default: policy/bundles/platform/1.0.0)
  --trusted <sti>  trusted keys-fil (default: policy/keys/trusted.json)
  --key-id <id>    nøgle-id ved keygen
`;

function commandVerify(args) {
  const bundle = readJson(join(args.bundle, "bundle.json"));
  const sig = readJson(join(args.bundle, "bundle.sig.json"));
  const { ok, digest, errors } = verifyBundleSignature(bundle, sig, loadTrustedKeys(args.trusted));
  if (!ok) {
    console.error("✘ Bundle-signatur ugyldig:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✔ Bundle ${bundle.metadata.name}@${bundle.metadata.version} er signeret og verificeret`);
  console.log(`  keyId:  ${sig.keyId}`);
  console.log(`  sha256: ${digest}`);
}

function commandDecide(args) {
  if (!args.input) throw new Error("decide kræver --input <fil>");
  const input = readJson(args.input);
  const pdp = createPdp({ bundleDir: args.bundle, trustedKeysPath: args.trusted });
  const decision = pdp.decide(input);
  console.log(JSON.stringify(decision, null, 2));
}

async function commandServe(args) {
  const pdp = createPdp({ bundleDir: args.bundle, trustedKeysPath: args.trusted });
  const port = await pdp.listen(args.port ?? 8181);
  console.log(`PDP lytter på http://127.0.0.1:${port}`);
  console.log(`  bundle: ${pdp.bundle.metadata.name}@${pdp.bundle.metadata.version} (${pdp.digest.slice(0, 12)}…)`);
  console.log(`  POST /v1/data/platform/ops/decision`);
}

function commandKeygen(args) {
  mkdirSync(keysDir, { recursive: true });
  const existing = existsSync(signingKeyPath) ? readJson(signingKeyPath) : null;
  if (existing) {
    console.error(`✘ ${signingKeyPath} findes allerede. Slet den bevidst for at generere en ny nøgle.`);
    process.exit(1);
  }
  const keypair = generateSigningKey();
  const record = { keyId: args.keyId, owner: "platform-demo", createdAt: new Date().toISOString(), ...keypair };
  writeFileSync(signingKeyPath, JSON.stringify(record, null, 2) + "\n");
  const trusted = existsSync(args.trusted) ? readJson(args.trusted) : { keys: {} };
  trusted.keys ??= {};
  trusted.keys[args.keyId] = { publicKey: keypair.publicKey, owner: record.owner, createdAt: record.createdAt };
  writeFileSync(args.trusted, JSON.stringify(trusted, null, 2) + "\n");
  console.log(`✔ Signeringsnøgle genereret: keyId=${args.keyId}`);
  console.log(`  privatnøgle (IKKE commit): ${signingKeyPath}`);
  console.log(`  offentlig nøgle tilføjet:  ${args.trusted}`);
}

function commandSign(args) {
  if (!existsSync(signingKeyPath)) {
    console.error(`✘ Mangler ${signingKeyPath}. Kør 'keygen' først.`);
    process.exit(1);
  }
  const key = readJson(signingKeyPath);
  const bundlePath = join(args.bundle, "bundle.json");
  const bundle = readJson(bundlePath);
  const sig = signBundle(bundle, { privateKey: key.privateKey, keyId: key.keyId });
  writeFileSync(join(args.bundle, "bundle.sig.json"), JSON.stringify(sig, null, 2) + "\n");
  console.log(`✔ Signerede ${bundle.metadata.name}@${bundle.metadata.version}`);
  console.log(`  keyId:  ${sig.keyId}`);
  console.log(`  sha256: ${sig.digestSha256}`);
  console.log(`  pin denne digest i modulernes policy.bundle.sha256`);
}

async function main() {
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
    case "decide":
      return commandDecide(args);
    case "serve":
      return commandServe(args);
    case "keygen":
      return commandKeygen(args);
    case "sign":
      return commandSign(args);
    default:
      console.error(`Ukendt kommando: ${args.command}\n\n${HELP}`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
