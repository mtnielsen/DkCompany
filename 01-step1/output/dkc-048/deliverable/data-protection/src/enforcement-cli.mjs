#!/usr/bin/env node
/**
 * DKC-048 — CLI for håndhævelsen af immutable data.
 *
 *   node data-protection/src/enforcement-cli.mjs render   # skriv manifester fra politikken
 *   node data-protection/src/enforcement-cli.mjs check    # politik, semantik, manifester, register og lager-selvtest
 *   node data-protection/src/enforcement-cli.mjs verify   # kør de negative storage-semantik-tests
 *
 * Selvtesten er deterministisk (`verifiedByHuman: false`); en målt verifikation
 * på et levende storage-produkt er NOT RUN.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImmutablePolicy, immutablePolicyProblems, enforcementRegisterProblems } from "./enforcement.mjs";
import { renderImmutablePolicy, IMMUTABLE_MANIFESTS_DIR } from "./enforcement-render.mjs";
import { loadRegister } from "./registry.mjs";
import { verifyStorageSemantics } from "./storage-semantics.mjs";
import { validateImmutableEnforcement } from "../../conformance/src/immutable-enforcement.mjs";
import { createStorageCluster } from "../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../storage/src/tenant-keys.mjs";
import { loadStoragePlan } from "../../storage/src/plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

function writeJson(root, rel, value) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function renderImmutable(root = repoRoot) {
  const manifests = renderImmutablePolicy(loadImmutablePolicy());
  for (const [rel, value] of manifests) writeJson(root, rel, value);
  return manifests;
}

function committed(root, dir) {
  const full = join(root, dir);
  return existsSync(full) ? readdirSync(full).filter((f) => f.endsWith(".json")).map((f) => `${dir}/${f}`) : [];
}

export function runImmutableCheck(root = repoRoot) {
  const problems = [];
  const policy = loadImmutablePolicy();
  const register = loadRegister();

  const validation = validateImmutableEnforcement(policy);
  for (const e of validation.errors) problems.push(`politik${e.path}: ${e.message}`);
  for (const p of enforcementRegisterProblems(policy, register.records)) problems.push(`register: ${p.message}`);

  const manifests = renderImmutablePolicy(policy);
  for (const [rel, value] of manifests) {
    const path = join(root, rel);
    if (!existsSync(path)) problems.push(`${rel} mangler; kør 'make immutable-render'`);
    else if (readFileSync(path, "utf8") !== JSON.stringify(value, null, 2) + "\n") problems.push(`${rel} er ude af trit; kør 'make immutable-render'`);
  }
  for (const rel of committed(root, IMMUTABLE_MANIFESTS_DIR)) {
    if (!manifests.has(rel)) problems.push(`${rel} er ikke genereret fra politikken`);
  }

  // Negativ selvtest af den faktiske lagersemantik.
  const rootDir = mkdtempSync(join(tmpdir(), "dkc-048-check-"));
  try {
    const store = createStorageCluster({ plan: loadStoragePlan(root), rootDir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
    const semantics = verifyStorageSemantics({ store, policy });
    if (!semantics.ok) problems.push(`storage-semantik fejlede: ${semantics.checks.filter((c) => !c.ok).map((c) => c.id).join(", ")}`);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }

  // Semantikken skal afvise brud.
  const negative = immutablePolicyProblems({ ...policy, agentDenials: { ...policy.agentDenials, forbiddenOperations: [] } });
  if (negative.length === 0) problems.push("semantikken afviser ikke en AI-rolle uden forbud");

  return { ok: problems.length === 0, problems, policy };
}

function verify() {
  const policy = loadImmutablePolicy();
  const rootDir = mkdtempSync(join(tmpdir(), "dkc-048-verify-"));
  try {
    const store = createStorageCluster({ plan: loadStoragePlan(repoRoot), rootDir, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
    const result = verifyStorageSemantics({ store, policy });
    for (const check of result.checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id} (${check.expectation} → ${check.actual})`);
    console.log(`produkt=${result.product}, verifiedByHuman=${result.verifiedByHuman}, kræver levende verifikation=${result.requiresLiveVerification}`);
    if (!result.ok) process.exit(1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2];
  if (command === "render") {
    const manifests = renderImmutable(repoRoot);
    console.log(`✔ Skrev ${manifests.size} håndhævelsesmanifester til ${IMMUTABLE_MANIFESTS_DIR}`);
    return;
  }
  if (command === "check") {
    const result = runImmutableCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Håndhævelseskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Immutable-håndhævelse, rollematrix, manifester, register og lagersemantik er konsistente");
    return;
  }
  if (command === "verify") {
    verify();
    return;
  }
  console.error("Brug: node data-protection/src/enforcement-cli.mjs <render|check|verify>");
  process.exit(2);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) main();
