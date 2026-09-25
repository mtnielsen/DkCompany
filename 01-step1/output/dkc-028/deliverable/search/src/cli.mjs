#!/usr/bin/env node
/**
 * DKC-028 — CLI for rettighedsbevidst videnssøgning.
 *
 *   node search/src/cli.mjs sync      # synkronisér kilder ind i et indeks
 *   node search/src/cli.mjs query     # kør en ACL-filtreret søgning
 *   node search/src/cli.mjs answer    # byg et svar med kildehenvisning
 *   node search/src/cli.mjs check     # validér kilder, politik, korpus og scenarier
 *   node search/src/cli.mjs render     # skriv rapporten
 *   node search/src/cli.mjs report     # skriv rapporten til stdout
 *   node search/src/cli.mjs drill      # kør den deterministiske kontrol
 *
 * En `drill` og `check` er deterministiske (`measured: false`); en målt
 * slettefrist på en levende BookStack er `make search-live` og er NOT RUN.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll } from "./model.mjs";
import { FileKnowledgeIndex } from "./index-store.mjs";
import { createBookstackClient } from "./bookstack.mjs";
import { createMockBookstack } from "./mock-bookstack.mjs";
import { syncSource } from "./ingest.mjs";
import { retrieve, embeddingRetrieve } from "./retrieval.mjs";
import { buildAnswer } from "./answer.mjs";
import { runSearchCheck, buildSearchReport, REPORT_GENERATED_AT } from "./check.mjs";
import { renderSearchReport } from "./report.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

async function withSyncedIndex(fn) {
  const all = loadAll(repoRoot);
  const ephemeral = !process.env.SEARCH_INDEX_DIR;
  const dir = process.env.SEARCH_INDEX_DIR ?? mkdtempSync(join(tmpdir(), "dkc028-cli-"));
  const index = FileKnowledgeIndex.open(dir);
  const mock = createMockBookstack({ corpus: all.corpus });
  const port = await mock.listen(0);
  try {
    for (const source of all.sources.sources) {
      const token = all.corpus.tenants[source.tenantId]?.token ?? "missing";
      const client = createBookstackClient({ baseUrl: `http://127.0.0.1:${port}`, token });
      await syncSource({ client, source, index, at: REPORT_GENERATED_AT });
    }
    return await fn({ all, index, mock, dir });
  } finally {
    await mock.close();
    if (ephemeral) rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "sync") {
    await withSyncedIndex(({ index, dir }) => {
      console.log(`✔ Synkroniserede ${index.size()} dokumenter til ${dir} (epoch ${index.epoch()})`);
    });
    return;
  }
  if (command === "query") {
    await withSyncedIndex(({ all, index }) => {
      const result = retrieve({ index, principal: { kind: "human", id: "oidc|bo.bertelsen", tenantId: "acme", groups: ["acme"], clearance: "internal" }, query: process.argv.slice(3).join(" ") || "onboarding", policy: all.policy });
      const emb = embeddingRetrieve({ index, principal: { kind: "human", id: "oidc|bo.bertelsen", tenantId: "acme", groups: ["acme"], clearance: "internal" }, query: process.argv.slice(3).join(" ") || "onboarding", policy: all.policy });
      console.log(JSON.stringify({ tenantId: result.tenantId, results: result.results.map((r) => ({ id: r.document.id, score: r.score })), embedding: emb.results.map((r) => ({ id: r.document.id, embedding: r.embedding })) }, null, 2));
    });
    return;
  }
  if (command === "answer") {
    await withSyncedIndex(({ all, index }) => {
      const query = process.argv.slice(3).join(" ") || "onboarding";
      const result = retrieve({ index, principal: { kind: "human", id: "oidc|bo.bertelsen", tenantId: "acme", groups: ["acme"], clearance: "internal" }, query, policy: all.policy });
      const answer = buildAnswer({ query, principal: { kind: "human", id: "oidc|bo.bertelsen", tenantId: "acme", groups: ["acme"], clearance: "internal" }, retrieval: result, policy: all.policy });
      process.stdout.write(JSON.stringify(answer, null, 2) + "\n");
    });
    return;
  }
  if (command === "check") {
    const result = await runSearchCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Videnssøgningskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Rettighedsbevidst videnssøgning er konsistent");
    return;
  }
  if (command === "render") {
    const report = await buildSearchReport(repoRoot);
    const rendered = renderSearchReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} søgeartefakter`);
    return;
  }
  if (command === "report") {
    const report = await buildSearchReport(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  if (command === "drill") {
    const result = await runSearchCheck(repoRoot);
    for (const s of result.report.scenarios) console.log(`${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} ${s.id}`);
    console.log(`${result.ok ? "PASS" : "FAIL"} deletion-deadline (${result.report.deletion.elapsedMs} ms / ${result.report.deletion.deadlineMs} ms)`);
    if (!result.ok) process.exit(1);
    return;
  }
  console.error("Brug: node search/src/cli.mjs <sync|query|answer|check|render|report|drill>");
  process.exit(2);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
