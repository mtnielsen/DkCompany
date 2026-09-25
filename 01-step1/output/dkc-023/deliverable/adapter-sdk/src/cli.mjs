#!/usr/bin/env node
/**
 * DKC-023 — CLI for adapter-SDK'en.
 *
 *   node adapter-sdk/src/cli.mjs write   # genskab releaseprofiler og statusdokument
 *   node adapter-sdk/src/cli.mjs check   # fejl hvis de er ude af trit med kandidater/manifester
 *   node adapter-sdk/src/cli.mjs report  # vis den menneskelæsbare kandidatrapport
 *
 * Releaseprofilerne udledes deterministisk af `adapter-sdk/registry.json`,
 * modulmanifesterne og kandidaterne i `contracts/examples`. De er derfor et
 * afledt artefakt, ikke en håndholdt påstand, og `check` fanger drift.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseProfile, assessCandidateGate } from "./candidates.mjs";
import { validateAdapterReleaseProfile } from "../../conformance/src/adapter-sdk.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const registryPath = join(repoRoot, "adapter-sdk", "registry.json");
const examplesDir = join(repoRoot, "contracts", "examples");
const statusDoc = join(repoRoot, "docs", "status", "adapter-sdk.md");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadRegistry() {
  const registry = loadJson(registryPath);
  return registry.adapters ?? [];
}

function loadInputs(entry) {
  const manifestPath = join(repoRoot, "modules", entry.module, "module-manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`manglende modulmanifest: ${manifestPath}`);
  const candidatePath = join(examplesDir, entry.candidate);
  if (!existsSync(candidatePath)) throw new Error(`manglende kandidat: ${candidatePath}`);
  return { manifest: loadJson(manifestPath), candidate: loadJson(candidatePath), candidatePath };
}

function buildFor(entry) {
  const { manifest, candidate } = loadInputs(entry);
  return buildReleaseProfile({
    candidate,
    manifest,
    negotiation: {
      supportedRanges: entry.supportedRanges,
      supportedEditions: entry.supportedEditions,
      onUnsupported: entry.onUnsupported ?? "refuse",
      requiredSso: entry.requiredSso !== false,
    },
    nativeAdmin: entry.nativeAdmin,
  });
}

function writeStatusDoc(profiles) {
  const lines = [
    "# Adapter-SDK og godkendelse",
    "",
    "> Genereret af `make adapter-sdk-write`. Redigér ikke manuelt.",
    "",
    "Hver adapter er godkendt på en eksakt upstream-version/edition. Gaten er hård:",
    "manglende obligatorisk SSO eller en uafklaret licens blokerer kandidaten.",
    "",
    "| Adapter | Upstream | Version | Edition | Gate | Blockers | Native admin |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const { entry, profile } of profiles) {
    const gate = profile.approvalGate;
    lines.push(
      `| ${entry.module} | ${profile.upstream.product} | ${profile.upstream.exactVersion} | ${profile.upstream.edition ?? "—"} | ${gate.status} | ${gate.blockers.length ? gate.blockers.join("; ") : "—"} | ${profile.nativeAdmin.exposed ? "EKSPONERET" : "beskyttet"} |`
    );
  }
  lines.push("", "Kør `make adapter-sdk-check` for at efterprøve at profilerne er i trit.", "");
  mkdirSync(dirname(statusDoc), { recursive: true });
  writeFileSync(statusDoc, lines.join("\n"));
}

function write() {
  const entries = loadRegistry();
  const profiles = [];
  for (const entry of entries) {
    const profile = buildFor(entry);
    const out = join(examplesDir, entry.releaseProfile);
    writeFileSync(out, JSON.stringify(profile, null, 2) + "\n");
    profiles.push({ entry, profile });
    console.log(`✔ skrev ${entry.releaseProfile} (gate: ${profile.approvalGate.status})`);
  }
  writeStatusDoc(profiles);
  console.log(`✔ skrev docs/status/adapter-sdk.md`);
}

function check() {
  const entries = loadRegistry();
  const problems = [];
  const profiles = [];
  for (const entry of entries) {
    let committed;
    const out = join(examplesDir, entry.releaseProfile);
    if (!existsSync(out)) {
      problems.push(`${entry.releaseProfile}: filen findes ikke (kør 'make adapter-sdk-write')`);
      continue;
    }
    committed = loadJson(out);
    const expected = buildFor(entry);
    profiles.push({ entry, profile: expected });
    if (JSON.stringify(committed) !== JSON.stringify(expected)) {
      problems.push(`${entry.releaseProfile}: er ude af trit med kandidat/manifest (kør 'make adapter-sdk-write')`);
    }
    const { ok, errors } = validateAdapterReleaseProfile(committed, undefined, { candidate: loadInputs(entry).candidate, manifest: loadInputs(entry).manifest });
    if (!ok) {
      problems.push(`${entry.releaseProfile}: ${errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
    }
  }
  if (!existsSync(statusDoc)) problems.push("docs/status/adapter-sdk.md mangler");
  if (problems.length) {
    console.error("✘ Adapter-SDK-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ ${entries.length} adaptere: kandidatrapport og releaseprofil er i trit og validerer`);
}

function report() {
  const entries = loadRegistry();
  for (const entry of entries) {
    const { candidate, manifest } = loadInputs(entry);
    const profile = buildFor(entry);
    const gate = assessCandidateGate({ candidate, requiredSso: entry.requiredSso !== false });
    console.log(`\n== ${entry.module} — ${candidate.name} ${candidate.exactVersion} (${candidate.edition?.name})`);
    console.log(`   manifest:      ${manifest.metadata.name}`);
    console.log(`   licens:        ${candidate.license?.type} (${candidate.license?.spdx})`);
    console.log(`   SSO:           ${candidate.sso?.supported ? candidate.sso.protocols.join("/") : "mangler"}`);
    console.log(`   gate:          ${gate.status}${gate.blockers.length ? ` — ${gate.blockers.join(", ")}` : ""}`);
    const full = Object.entries(profile.verbMatrix).filter(([, v]) => v.conformance === "full").length;
    const partial = Object.entries(profile.verbMatrix).filter(([, v]) => v.conformance === "partial").length;
    const unsupported = Object.entries(profile.verbMatrix).filter(([, v]) => v.conformance === "unsupported").length;
    console.log(`   ops-verber:    ${full} full, ${partial} partial, ${unsupported} unsupported`);
  }
}

const command = process.argv[2];
try {
  if (command === "write") write();
  else if (command === "check") check();
  else if (command === "report") report();
  else {
    console.error("Brug: node adapter-sdk/src/cli.mjs <write|check|report>");
    process.exit(2);
  }
} catch (err) {
  console.error(err.stack ?? err.message);
  process.exit(1);
}
