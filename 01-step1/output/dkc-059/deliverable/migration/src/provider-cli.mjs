#!/usr/bin/env node
/**
 * DKC-059 — CLI for providerkontrakter og migrationskontrol.
 *
 *   node migration/src/provider-cli.mjs check                 # validér katalog, register, matrix og fixtures
 *   node migration/src/provider-cli.mjs preflight <from> <to> # forhandl capabilities og klassificér skiftet
 *   node migration/src/provider-cli.mjs plan <fixtureId>      # vis cutover-planen for en fixture
 *   node migration/src/provider-cli.mjs execute <fixtureId>   # kør et skift mod en midlertidig butik
 *   node migration/src/provider-cli.mjs render                # skriv providerrapporten
 *   node migration/src/provider-cli.mjs report                # skriv providerrapporten til stdout
 *   node migration/src/provider-cli.mjs drill                 # kør den deterministiske kontrol
 *
 * En `check` og `drill` er deterministiske (`measured: false`). En rigtig
 * udskiftning mod en levende provider kræver en ekstern installation og er
 * NOT RUN.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, REPORT_GENERATED_AT } from "./provider-model.mjs";
import { preflightSwap } from "./provider-negotiate.mjs";
import { runProviderCheck, buildProviderReport, setupProvider, PRINCIPALS } from "./provider-check.mjs";
import { planSwap, executeSwap } from "./provider-swap.mjs";
import { recordApproval } from "./approval.mjs";
import { renderProviderReport } from "./provider-report.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function fixtureById(all, id) {
  const found = all.swaps.find((entry) => entry.fixture.id === id);
  if (!found) throw new Error(`swap-fixturen '${id}' findes ikke`);
  return found.fixture;
}

async function main() {
  const command = process.argv[2];
  const all = loadAll(repoRoot);

  if (command === "check") {
    const result = await runProviderCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Providerkontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Providerkontrakter og migrationskontrol er konsistente");
    return;
  }

  if (command === "preflight") {
    const [, , , from, to] = process.argv;
    const result = preflightSwap({ providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from, to });
    console.log(JSON.stringify({ from, to, mode: result.mode, status: result.status, allowed: result.allowed, problems: result.problems }, null, 2));
    return;
  }

  if (command === "plan") {
    const fixture = fixtureById(all, process.argv[3]);
    const plan = planSwap({ fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy });
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (command === "execute") {
    const fixture = fixtureById(all, process.argv[3]);
    const { store, cleanup } = setupProvider();
    const snapshotsDir = mkdtempSync(join(tmpdir(), "dkc059-snap-"));
    try {
      const approval = recordApproval({ store, principal: PRINCIPALS.ada, tenantId: fixture.tenantId, appId: fixture.appId, contentApproved: true, aclApproved: true, evidenceRef: `evidence://provider/${fixture.id}`, at: REPORT_GENERATED_AT });
      const { receipt, reconciliation } = executeSwap({ store, fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PRINCIPALS.ada, approval, at: REPORT_GENERATED_AT, snapshotDir: join(snapshotsDir, fixture.id) });
      console.log(`✔ ${fixture.id}: ${reconciliation.counts.created} poster, checksums ${reconciliation.checksums.match ? "matcher" : "matcher IKKE"}, status ${receipt.status}`);
      console.log(JSON.stringify({ links: reconciliation.links, authorization: reconciliation.authorization, references: reconciliation.references, oldProviderReadOnly: receipt.oldProviderReadOnly, credentials: receipt.credentials }, null, 2));
    } finally {
      rmSync(snapshotsDir, { recursive: true, force: true });
      cleanup();
    }
    return;
  }

  if (command === "render") {
    const { report } = await buildProviderReport(repoRoot);
    const rendered = renderProviderReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} providerartefakter`);
    return;
  }

  if (command === "report") {
    const { report } = await buildProviderReport(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  if (command === "drill") {
    const result = await runProviderCheck(repoRoot);
    for (const s of result.report.scenarios) console.log(`${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} ${s.id}`);
    console.log(`${result.ok ? "PASS" : "FAIL"} provider (${result.report.totals.providers} providere, ${result.report.totals.compatibilityRows} skift, ${result.report.totals.fixtures} fixtures)`);
    if (!result.ok) process.exit(1);
    return;
  }

  console.error("Brug: node migration/src/provider-cli.mjs <check|preflight|plan|execute|render|report|drill> [args]");
  process.exit(2);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
