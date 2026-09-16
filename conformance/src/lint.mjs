#!/usr/bin/env node
/**
 * 0.1: Lint. Alle JSON-filer skal kunne parses, og tekstfiler skal være
 * velformede (ingen trailing whitespace, afsluttende newline).
 * Bevidst uden eksterne afhængigheder, så CI ikke selv kan brække.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { repoRoot } from "./schemas.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git", ".conformance-out", "dist", "coverage"]);
const TEXT_EXT = new Set([".json", ".md", ".mjs", ".js", ".yml", ".yaml", ".sh", ".txt"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const problems = [];
const files = walk(repoRoot);
let jsonFiles = 0;

for (const file of files) {
  const rel = relative(repoRoot, file);
  const ext = extname(file);
  if (!TEXT_EXT.has(ext)) continue;
  const raw = readFileSync(file, "utf8");

  if (ext === ".json") {
    jsonFiles += 1;
    try {
      JSON.parse(raw);
    } catch (err) {
      problems.push(`${rel}: ugyldig JSON (${err.message})`);
    }
  }

  if (raw.length > 0 && !raw.endsWith("\n")) problems.push(`${rel}: mangler afsluttende newline`);
  raw.split("\n").forEach((line, i) => {
    if (/[ \t]+$/.test(line)) problems.push(`${rel}:${i + 1}: trailing whitespace`);
  });
}

if (problems.length) {
  console.error("✘ Lint fejlede:\n");
  for (const p of problems.slice(0, 50)) console.error(`  - ${p}`);
  if (problems.length > 50) console.error(`  ... og ${problems.length - 50} mere`);
  process.exit(1);
}
console.log(`✔ Lint OK (${jsonFiles} JSON-filer, ${files.length} filer gennemgået)`);
