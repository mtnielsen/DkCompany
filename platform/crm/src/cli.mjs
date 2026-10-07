#!/usr/bin/env node
/**
 * DKC-030 — CLI for CRM med entydigt ejerskab af kundedata.
 *
 *   node crm/src/cli.mjs candidates  # kør kandidatchecken
 *   node crm/src/cli.mjs sync        # spejl upstream ind i butikken
 *   node crm/src/cli.mjs export      # eksportér en tenant med stabile referencer
 *   node crm/src/cli.mjs delete      # slet en kunde på tværs af flader
 *   node crm/src/cli.mjs check       # validér kilder, politik og scenarier
 *   node crm/src/cli.mjs render      # skriv rapporten
 *   node crm/src/cli.mjs report      # skriv rapporten til stdout
 *   node crm/src/cli.mjs drill       # kør den deterministiske kontrol
 *
 * En `check` og `drill` er deterministiske (`measured: false`); en målt
 * integration mod en levende EspoCRM er `make crm-live` og er NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { setupCrm, runCrmCheck, buildCrmReport, REPORT_GENERATED_AT } from "./check.mjs";
import { evaluateCandidates } from "./candidate-check.mjs";
import { exportTenant } from "./sync.mjs";
import { deleteCustomer } from "./retention.mjs";
import { renderCrmReport } from "./report.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const ADA = { kind: "human", id: "oidc|ada.acme", tenantId: "acme", roles: ["sales"], clearance: "confidential" };

async function main() {
  const command = process.argv[2];
  if (command === "candidates") {
    const evaluation = evaluateCandidates(repoRoot);
    console.log(JSON.stringify(evaluation, null, 2));
    return;
  }
  if (command === "sync" || command === "export" || command === "delete") {
    const { store, all, close } = await setupCrm();
    try {
      const acme = all.sources.sources.find((s) => s.id === "espocrm-acme");
      if (command === "sync") {
        console.log(JSON.stringify(store.listRecords({ tenantId: "acme" }).map((r) => ({ reference: r.reference, entityType: r.entityType, name: r.name })), null, 2));
      } else if (command === "export") {
        console.log(JSON.stringify(exportTenant({ store, tenantId: "acme", principal: ADA, source: acme }), null, 2));
      } else {
        const receipt = deleteCustomer({ store, tenantId: "acme", accountReference: "crm:acme:Account:1002", principal: { kind: "human", id: "oidc|ben.acme", tenantId: "acme", roles: ["sales"], clearance: "internal" }, source: acme, holds: [], reason: "kundeanmodning", now: REPORT_GENERATED_AT });
        console.log(JSON.stringify(receipt, null, 2));
      }
    } finally {
      await close();
    }
    return;
  }
  if (command === "check") {
    const result = await runCrmCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ CRM-kontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ CRM med entydigt ejerskab af kundedata er konsistent");
    return;
  }
  if (command === "render") {
    const report = await buildCrmReport(repoRoot);
    const rendered = renderCrmReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} CRM-artefakter`);
    return;
  }
  if (command === "report") {
    const report = await buildCrmReport(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  if (command === "drill") {
    const result = await runCrmCheck(repoRoot);
    for (const s of result.report.scenarios) console.log(`${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} ${s.id}`);
    console.log(`${result.ok ? "PASS" : "FAIL"} crm (valgt kandidat: ${result.report.candidateSample.selected}, ${result.report.totals.records} poster)`);
    if (!result.ok) process.exit(1);
    return;
  }
  console.error("Brug: node crm/src/cli.mjs <candidates|sync|export|delete|check|render|report|drill>");
  process.exit(2);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
