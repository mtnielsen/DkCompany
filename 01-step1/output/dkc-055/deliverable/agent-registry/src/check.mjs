#!/usr/bin/env node
/**
 * DKC-055 — fokuseret kontrol af rollerne.
 *
 *   node agent-registry/src/check.mjs
 *
 * Validérer at hvert agent-manifest i repoet har præcis én gyldig rolle, at
 * capability-verberne er tilladte for rollen, og at ingen AI kan være godkender.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLES, roleMayApprove, ROLE_VERBS, validateRoleManifest } from "./roles.mjs";
import { validateManifest } from "../../runtime/src/boundary.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const errors = [];

function manifestPaths() {
  const paths = [];
  const modulesDir = join(repoRoot, "modules");
  if (existsSync(modulesDir)) {
    for (const mod of readdirSync(modulesDir)) {
      const agentsDir = join(modulesDir, mod, "agents");
      if (!existsSync(agentsDir)) continue;
      for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".json"))) paths.push(join(agentsDir, file));
    }
  }
  const example = join(repoRoot, "contracts", "examples", "agent-manifest.example.json");
  if (existsSync(example)) paths.push(example);
  return paths;
}

const paths = manifestPaths();
const roleCounts = {};
for (const path of paths) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    errors.push(`${path}: ugyldig JSON (${err.message})`);
    continue;
  }
  const roleCheck = validateRoleManifest(manifest);
  for (const e of roleCheck.errors) errors.push(`${path}${e.path}: ${e.message}`);
  const shape = validateManifest(manifest);
  for (const e of shape.errors) errors.push(`${path}${e.path}: ${e.message}`);
  if (!roleCheck.ok || !shape.ok) continue;
  roleCounts[manifest.role] = (roleCounts[manifest.role] ?? 0) + 1;
  if (roleMayApprove(manifest.role)) errors.push(`${path}: rollen '${manifest.role}' må ikke kunne godkende`);
}

for (const role of ROLES) {
  if (!Array.isArray(ROLE_VERBS[role]) || ROLE_VERBS[role].length === 0) errors.push(`rollen '${role}' har ingen tilladte verber`);
  if (roleMayApprove(role)) errors.push(`rollen '${role}' må ikke kunne godkende`);
}

if (errors.length) {
  console.error("✘ Rollekontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ ${paths.length} agent-manifester har præcis én rolle`);
console.log(`✔ Roller i brug: ${Object.entries(roleCounts).map(([r, n]) => `${r}=${n}`).join(", ") || "ingen"}`);
console.log(`✔ ${ROLES.length} roller har verbumlister, og ingen AI kan godkende`);
