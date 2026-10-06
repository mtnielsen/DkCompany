#!/usr/bin/env node
/**
 * DKC-031 — CLI for migrations- og exitværktøjer.
 *
 *   node migration/src/cli.mjs check       # validér kilder, politik, dækning og scenarier
 *   node migration/src/cli.mjs dry-run     # afstem hver kilde uden at skrive
 *   node migration/src/cli.mjs import      # importér korpus resumabelt i en midlertidig butik
 *   node migration/src/cli.mjs export      # skriv en exit-eksport til migration/exports/
 *   node migration/src/cli.mjs render      # skriv rapporten
 *   node migration/src/cli.mjs report      # skriv rapporten til stdout
 *   node migration/src/cli.mjs drill       # kør den deterministiske kontrol
 *
 * En `check` og `drill` er deterministiske (`measured: false`). En rigtig
 * cutover mod en levende kilde og en menneskelig pilotgodkendelse kræver en
 * ekstern installation og er NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll } from "./model.mjs";
import { buildCoverage } from "./coverage.mjs";
import { setupMigration, runMigrationCheck, buildMigrationReport, REPORT_GENERATED_AT } from "./check.mjs";
import { dryRun, importBatch } from "./import.mjs";
import { buildExport, writeExport } from "./export.mjs";
import { renderMigrationReport } from "./report.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function selectedSource(all, sourceId) {
  if (sourceId) {
    const source = all.sources.sources.find((s) => s.id === sourceId);
    if (!source) throw new Error(`kilden '${sourceId}' findes ikke`);
    return [source];
  }
  return all.sources.sources;
}

function objectsFor(all, source) {
  return all.corpus.objects.filter((o) => o.appId === source.appId && o.tenantId === source.tenantId);
}

async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  if (command === "check") {
    const result = await runMigrationCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Migrationskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Migrations- og exitværktøjer er konsistente");
    return;
  }

  if (command === "dry-run") {
    const all = loadAll(repoRoot);
    const coverage = buildCoverage({ sources: all.sources, at: REPORT_GENERATED_AT });
    for (const source of selectedSource(all, arg)) {
      const reconciliation = dryRun({ source, objects: objectsFor(all, source), coverage, at: REPORT_GENERATED_AT });
      console.log(`# ${source.id} (${source.format.id}@${source.format.version})`);
      console.log(JSON.stringify({ counts: reconciliation.counts, checksums: reconciliation.checksums, errors: reconciliation.errors, coverageLosses: reconciliation.coverageLosses.length }, null, 2));
    }
    return;
  }

  if (command === "import") {
    const all = loadAll(repoRoot);
    const coverage = buildCoverage({ sources: all.sources, at: REPORT_GENERATED_AT });
    const { store, cleanup } = setupMigration();
    try {
      for (const source of selectedSource(all, arg)) {
        const reconciliation = importBatch({ store, source, objects: objectsFor(all, source), coverage, at: REPORT_GENERATED_AT });
        console.log(`✔ ${source.id}: ${reconciliation.counts.created} oprettet, ${reconciliation.counts.conflicts} konflikt(er), checksums ${reconciliation.checksums.match ? "matcher" : "matcher IKKE"}`);
      }
    } finally {
      cleanup();
    }
    return;
  }

  if (command === "export") {
    const all = loadAll(repoRoot);
    const coverage = buildCoverage({ sources: all.sources, at: REPORT_GENERATED_AT });
    const { store, cleanup } = setupMigration();
    try {
      for (const source of selectedSource(all, arg)) {
        importBatch({ store, source, objects: objectsFor(all, source), coverage, at: REPORT_GENERATED_AT });
        const exported = buildExport({ store, tenantId: source.tenantId, appId: source.appId, coverage, at: REPORT_GENERATED_AT });
        const dir = join(repoRoot, "migration", "exports", `${source.tenantId}-${source.appId}`);
        const written = writeExport({ dir, exported });
        console.log(`✔ ${source.tenantId}/${source.appId}: ${written.manifest.recordCount} poster, checksum ${written.manifest.checksum.slice(0, 12)}… -> migration/exports/${source.tenantId}-${source.appId}`);
      }
    } finally {
      cleanup();
    }
    return;
  }

  if (command === "render") {
    const report = await buildMigrationReport(repoRoot);
    const rendered = renderMigrationReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} migrationsartefakter`);
    return;
  }

  if (command === "report") {
    const report = await buildMigrationReport(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  if (command === "drill") {
    const result = await runMigrationCheck(repoRoot);
    for (const s of result.report.scenarios) console.log(`${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} ${s.id}`);
    console.log(`${result.ok ? "PASS" : "FAIL"} migration (${result.report.totals.sources} kilder, ${result.report.totals.lostFacets} tabte facetter)`);
    if (!result.ok) process.exit(1);
    return;
  }

  console.error("Brug: node migration/src/cli.mjs <check|dry-run|import|export|render|report|drill> [sourceId]");
  process.exit(2);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
