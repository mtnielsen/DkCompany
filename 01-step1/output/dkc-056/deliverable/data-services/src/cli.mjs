#!/usr/bin/env node
/**
 * DKC-056 — CLI for datatjenester.
 *
 *   node data-services/src/cli.mjs render            # Markdown til stdout
 *   node data-services/src/cli.mjs write             # skriv docs/compliance/data-services.{md,html}
 *   node data-services/src/cli.mjs check             # fejl hvis dokumenterne er ude af trit
 *   node data-services/src/cli.mjs explain <kilde>   # vis scope og ejerskab for en kilde
 *   node data-services/src/cli.mjs preview <profil>  # vis ansvarsmatrix for en profil
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll, repoRoot } from "./registry.mjs";
import { renderMarkdown, renderHtml } from "./render.mjs";

export const markdownPath = join(repoRoot, "docs", "compliance", "data-services.md");
export const htmlPath = join(repoRoot, "docs", "compliance", "data-services.html");

function renderAll() {
  const { profiles, sources, bindings } = loadAll();
  return { markdown: renderMarkdown({ profiles, sources, bindings }), html: renderHtml({ profiles, sources, bindings }) };
}

export function write() {
  const { markdown, html } = renderAll();
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, markdown);
  writeFileSync(htmlPath, html);
  return { markdownPath, htmlPath };
}

export function check() {
  const { markdown, html } = renderAll();
  for (const [path, expected] of [[markdownPath, markdown], [htmlPath, html]]) {
    if (!existsSync(path)) throw new Error(`${relative(repoRoot, path)} mangler. Kør 'make data-services-write'.`);
    if (readFileSync(path, "utf8") !== expected) {
      throw new Error(`${relative(repoRoot, path)} er ude af trit med registry-data. Kør 'make data-services-write'.`);
    }
  }
}

const HELP = `Brug: node data-services/src/cli.mjs <kommando>

Kommandøer:
  render            skriv Markdown til stdout
  write             skriv docs/compliance/data-services.md og .html
  check             fejl hvis dokumenterne ikke matcher registry-data
  explain <kilde>   forklar scope, ejerskab og ekstern-politik for en datakilde
  preview <profil>  vis ansvarsmatrix for en databaseprofil
`;

function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  try {
    const { profiles, sources } = loadAll();
    if (command === "render") {
      process.stdout.write(renderAll().markdown);
    } else if (command === "write") {
      const paths = write();
      console.log(`✔ Skrev ${relative(repoRoot, paths.markdownPath)} og ${relative(repoRoot, paths.htmlPath)}`);
    } else if (command === "check") {
      check();
      console.log(`✔ ${relative(repoRoot, markdownPath)} matcher registry-data`);
    } else if (command === "explain") {
      const name = process.argv[3];
      const source = sources.find((s) => s.data.metadata.name === name);
      if (!source) throw new Error(`ukendt datakilde '${name}'`);
      const s = source.data;
      console.log(`${s.metadata.name} (${s.sourceType}) — dataejer: ${s.dataOwnership.owner.name}`);
      console.log(`  scope: ${s.access.allowedTables.join(", ")} (read-only: ${s.access.readOnly})`);
      console.log(`  secret: ${s.connection.secretRef}`);
      console.log(`  ekstern politik: treatAsOwnDatabase=${s.externalPolicy.treatAsOwnDatabase}, autoMigrate=${s.externalPolicy.autoMigrate}, autoBackup=${s.externalPolicy.autoBackup}`);
    } else if (command === "preview") {
      const name = process.argv[3];
      const profile = profiles.find((p) => p.data.metadata.name === name);
      if (!profile) throw new Error(`ukendt profil '${name}'`);
      const p = profile.data;
      console.log(`${p.metadata.name} (${p.profileType}, ${p.engine.family})`);
      for (const [key, entry] of Object.entries(p.responsibilityMatrix)) {
        console.log(`  ${key.padEnd(10)} ${entry.owner.padEnd(8)} ${entry.accountableHuman.name} (${entry.accountableHuman.role})`);
      }
    } else {
      console.error(`Ukendt kommando: ${command}\n\n${HELP}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
