#!/usr/bin/env node
/**
 * DKC-014 — CLI for forsyningskæden.
 *
 *   node supply-chain/src/cli.mjs sbom                  # skriv deterministisk SBOM
 *   node supply-chain/src/cli.mjs scan                  # hent OSV-advisories (netværk)
 *   node supply-chain/src/cli.mjs render                # SBOM + artefaktmanifest + statusdokument
 *   node supply-chain/src/cli.mjs check                 # SBOM/manifest i sync, containere, beskyttelse, sårbarheder
 *   node supply-chain/src/cli.mjs vuln-check            # offline sårbarhedspolitik mod cachet scanning
 *   node supply-chain/src/cli.mjs verify                # afvis pladsholder-/usignerede deployment-digests
 *   node supply-chain/src/cli.mjs sign                  # signér byggede artefakter (kræver DKC_RELEASE_SIGNING_KEY)
 *   node supply-chain/src/cli.mjs containers check|plan|build
 *
 * `check` er deterministisk og offline. `scan` er det eneste netværkskald.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, digestOfFile } from "./digest.mjs";
import { emitSbom, verifySbomSync } from "./sbom.mjs";
import { buildPlan, checkContainers, runContainerBuilds } from "./containers.mjs";
import { CACHE_PATH, collectNpmDependencies, evaluateVulnerabilities, loadScanCache, loadVulnerabilityPolicy, queryOsv, writeScanCache } from "./vuln.mjs";
import { checkArtifactManifest, checkReleaseProtection, generateArtifactManifest, verifyDeployments } from "./release-policy.mjs";
import { signArtifact } from "./signature.mjs";
import { renderSupplyChainDoc } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

export const SBOM_PATH = "release/sbom/platform-sbom.cdx.json";
export const MANIFEST_PATH = "release/artifacts.json";
export const STATUS_DOC_PATH = "docs/status/supply-chain.md";

function gitCommit(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function renderAll(root = repoRoot) {
  const sbom = emitSbom(root);
  write(root, SBOM_PATH, JSON.stringify(sbom, null, 2) + "\n");
  const sbomDigest = digestOfFile(join(root, SBOM_PATH));
  const manifest = generateArtifactManifest(root, {
    sourceCommit: gitCommit(root),
    sbomRef: SBOM_PATH,
    sbomDigest,
    builtAt: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000).toISOString(),
  });
  write(root, MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  const containers = checkContainers(root);
  const scan = loadScanCache(root);
  const vuln = scan ? evaluateVulnerabilities(scan, loadVulnerabilityPolicy(root)) : { ok: false, problems: ["ingen cachet scanning"], summary: null };
  write(root, STATUS_DOC_PATH, renderSupplyChainDoc({ root, sbom, sbomDigest, manifest, containers, scan, vuln }));
  return { sbom, sbomDigest, manifest, containers, scan, vuln };
}

export function runCheck(root = repoRoot) {
  const problems = [];
  const sbom = verifySbomSync(root, existsSync(join(root, SBOM_PATH)) ? JSON.parse(readFileSync(join(root, SBOM_PATH), "utf8")) : null);
  for (const p of sbom.problems) problems.push(`SBOM: ${p}`);
  const sbomDigest = digestOfFile(join(root, SBOM_PATH));
  const expectedManifest = generateArtifactManifest(root, {
    sourceCommit: gitCommit(root),
    sbomRef: SBOM_PATH,
    sbomDigest,
    builtAt: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000).toISOString(),
  });
  if (!existsSync(join(root, MANIFEST_PATH))) problems.push(`${MANIFEST_PATH} mangler`);
  else {
    const committed = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
    if (canonicalize(committed) !== canonicalize(expectedManifest)) problems.push(`${MANIFEST_PATH} er ude af trit; kør 'make supply-chain-sbom'`);
    const manifestCheck = checkArtifactManifest(root, committed, { sbomDigest });
    for (const p of manifestCheck.problems) problems.push(p);
  }
  const containers = checkContainers(root);
  for (const p of containers.problems) problems.push(p);
  const protection = checkReleaseProtection(root);
  for (const p of protection.problems) problems.push(p);
  const scan = loadScanCache(root);
  const vuln = evaluateVulnerabilities(scan, loadVulnerabilityPolicy(root));
  for (const p of vuln.problems) problems.push(`sårbarhed: ${p}`);
  return { ok: problems.length === 0, problems, containers, protection, vuln, sbomDigest };
}

function commandSbom(root) {
  const sbom = emitSbom(root);
  write(root, SBOM_PATH, JSON.stringify(sbom, null, 2) + "\n");
  console.log(`✔ Skrev ${SBOM_PATH} (${sbom.components.length} komponenter)`);
}

async function commandScan(root) {
  const dependencies = collectNpmDependencies(root);
  console.log(`Scanner ${dependencies.length} npm-afhængigheder mod https://api.osv.dev …`);
  const scan = await queryOsv(dependencies);
  writeScanCache(root, scan);
  const advisories = Object.keys(scan.advisories ?? {}).length;
  console.log(`✔ Skrev ${CACHE_PATH} (${advisories} advisories)`);
}

function commandCheck(root) {
  const result = runCheck(root);
  if (result.problems.length) {
    console.error("✘ Forsyningskædekontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Forsyningskædekontrol bestået (SBOM-digest ${result.sbomDigest.slice(0, 12)}…)`);
}

function commandVulnCheck(root) {
  const scan = loadScanCache(root);
  const policy = loadVulnerabilityPolicy(root);
  const result = evaluateVulnerabilities(scan, policy);
  if (result.problems.length) {
    console.error("✘ Sårbarhedspolitik fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Sårbarhedspolitik bestået (${result.summary.advisories} advisories, ${result.summary.failed} blokerende)`);
}

function commandVerify(root) {
  if (!existsSync(join(root, MANIFEST_PATH))) {
    console.error(`${MANIFEST_PATH} mangler; kør 'make supply-chain-sbom'`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  const result = verifyDeployments(root, manifest);
  if (result.problems.length) {
    console.error("✘ Deployment-verifikation blokeret:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ Alle ${result.deployed} deployede containere matcher et signeret artefakt`);
}

function commandSign(root) {
  const key = process.env.DKC_RELEASE_SIGNING_KEY;
  if (!key) {
    console.error("DKC_RELEASE_SIGNING_KEY er ikke sat; signering er NOT RUN i dette miljø.");
    process.exit(2);
  }
  if (!existsSync(join(root, MANIFEST_PATH))) {
    console.error(`${MANIFEST_PATH} mangler; kør 'make supply-chain-sbom'`);
    process.exit(2);
  }
  const privateKeyPem = existsSync(key) ? readFileSync(key, "utf8") : key;
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  let signed = 0;
  for (const artifact of manifest.artifacts) {
    if (artifact.status === "not-built") continue;
    artifact.signature = signArtifact(privateKeyPem, artifact);
    artifact.status = "signed";
    delete artifact.reason;
    signed += 1;
  }
  write(root, MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✔ Signerede ${signed} artefakter i ${MANIFEST_PATH}`);
}

function main() {
  const [command, sub] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log("Brug: node supply-chain/src/cli.mjs <sbom|scan|render|check|verify|containers>");
    return;
  }
  if (command === "sbom") commandSbom(repoRoot);
  else if (command === "scan") commandScan(repoRoot).catch((err) => { console.error(err.message); process.exit(1); });
  else if (command === "render") {
    renderAll(repoRoot);
    console.log(`✔ Skrev ${SBOM_PATH}, ${MANIFEST_PATH} og ${STATUS_DOC_PATH}`);
  } else if (command === "check") commandCheck(repoRoot);
  else if (command === "vuln-check") commandVulnCheck(repoRoot);
  else if (command === "verify") commandVerify(repoRoot);
  else if (command === "sign") commandSign(repoRoot);
  else if (command === "containers") {
    if (sub === "plan") {
      for (const entry of buildPlan(repoRoot)) console.log(`${entry.component}: ${entry.command.join(" ")}`);
    } else if (sub === "build") {
      const result = runContainerBuilds(repoRoot);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "pass") process.exit(1);
    } else {
      const result = checkContainers(repoRoot);
      if (!result.ok) {
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log(`✔ ${result.catalog.images.length} containere og deres Dockerfiles er pinnet og hærdet`);
    }
  } else {
    console.error(`Ukendt kommando: ${command}`);
    process.exit(2);
  }
}

main();
