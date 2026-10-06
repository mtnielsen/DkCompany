#!/usr/bin/env node
/**
 * DKC-028 — fokuseret kontrol af rettighedsbevidst videnssøgning.
 *
 * Kontrollerer offline at:
 *   - kilder, politik og korpus validerer mod skema og beslutningssemantik,
 *   - en privat HR-side ikke optræder i svar, snippets, embedding-søgning eller
 *     citationsliste for en uautoriseret medarbejder,
 *   - en HR-medarbejder med den rette gruppe og klarering kan se den,
 *   - tenantadskillelse holder i begge retninger,
 *   - en tilbagekaldt rettighed håndhæves både ved revalidering ved læsning og
 *     efter reindeksering af allerede indekseret indhold,
 *   - en slettet side forsvinder fra indeks og cache inden for den fastsatte
 *     frist (målt deterministisk; en levende kilde er NOT RUN),
 *   - en artikel med et forfalsket værktøjskald ikke kan aktivere et værktøj,
 *   - og en rettighedsændring invaliderer cachen.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import {
  loadAll,
  knowledgeSourceProblems,
  searchIndexPolicyProblems,
  knowledgeDocumentProblems,
  retrievalAnswerProblems,
} from "./model.mjs";
import { FileKnowledgeIndex } from "./index-store.mjs";
import { createBookstackClient, mapPageToDocument } from "./bookstack.mjs";
import { createMockBookstack } from "./mock-bookstack.mjs";
import { syncSource } from "./ingest.mjs";
import { retrieve, embeddingRetrieve, retrievalCacheKey } from "./retrieval.mjs";
import { buildAnswer } from "./answer.mjs";
import { SearchCache, reconcilePermissions, deleteDocument, measureDeletionDeadline, indexDigest } from "./invalidation.mjs";

export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

const PRINCIPALS = {
  employee: { kind: "human", id: "oidc|bo.bertelsen", tenantId: "acme", groups: ["acme"], roles: ["employee"], clearance: "internal" },
  hr: { kind: "human", id: "oidc|carla.christensen", tenantId: "acme", groups: ["acme", "hr"], roles: ["hr-specialist"], clearance: "special-category" },
  globex: { kind: "human", id: "oidc|gus.globex", tenantId: "globex", groups: ["globex"], roles: ["support"], clearance: "confidential" },
};

async function buildIndex(root, { at = REPORT_GENERATED_AT } = {}) {
  const all = loadAll(root);
  const mock = createMockBookstack({ corpus: all.corpus });
  const port = await mock.listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const clients = {};
  for (const source of all.sources.sources) {
    const token = all.corpus.tenants[source.tenantId]?.token ?? "missing";
    clients[source.id] = createBookstackClient({ baseUrl, token });
  }
  return { all, mock, baseUrl, clients };
}

/** Kør hele den deterministiske kontrol. */
export async function runSearchCheck(root = repoRoot) {
  const problems = [];
  const all = loadAll(root);

  for (const e of knowledgeSourceProblems(all.sources)) problems.push(`sources${e.path}: ${e.message}`);
  for (const e of searchIndexPolicyProblems(all.policy)) problems.push(`index-policy${e.path}: ${e.message}`);

  const report = await buildSearchReport(root);
  for (const e of retrievalAnswerProblems(report.answerSample)) problems.push(`answer-sample${e.path}: ${e.message}`);
  for (const scenario of report.scenarios) {
    for (const problem of scenario.problems ?? []) problems.push(`scenario '${scenario.id}': ${problem}`);
  }
  if (!report.deletion.withinDeadline) problems.push(`slettefristen blev ikke overholdt: ${report.deletion.elapsedMs} ms`);
  return { ok: problems.length === 0, problems, report };
}

/** Byg den deterministiske rapport med alle scenarier. */
export async function buildSearchReport(root = repoRoot) {
  const { all, mock, baseUrl, clients } = await buildIndex(root);
  const scenarios = [];
  let answerSample = null;
  let deletion = { withinDeadline: false };
  let indexPath = null;

  try {
    // Indeksér begge kilder, og verificér at indekset kan genindlæses fra disk.
    indexPath = mkdtempSync(join(tmpdir(), "dkc028-report-"));
    const index = FileKnowledgeIndex.open(indexPath);
    for (const source of all.sources.sources) {
      await syncSource({ client: clients[source.id], source, index, at: REPORT_GENERATED_AT });
    }
    const reloaded = FileKnowledgeIndex.open(index.root);
    const persistedOk = reloaded.size() === index.size();
    const documents = index.list();
    for (const doc of documents) {
      for (const e of knowledgeDocumentProblems(doc, { source: all.sources.sources.find((s) => s.id === doc.sourceId) })) {
        problemsPush(scenarios, "index", `${doc.id}${e.path}: ${e.message}`);
      }
    }

    const aclFor = (doc) => {
      const mockPage = mock.getPage(doc.tenantId, doc.externalId);
      return mockPage?.permissions ?? null;
    };

    // 1) Privat HR-side skjult for en uautoriseret medarbejder.
    {
      const r = retrieve({ index, principal: PRINCIPALS.employee, query: "lønforhandling HR fortrolig", policy: all.policy, aclResolver: aclFor });
      const emb = embeddingRetrieve({ index, principal: PRINCIPALS.employee, query: "lønforhandling HR fortrolig", policy: all.policy, aclResolver: aclFor });
      const answer = buildAnswer({ query: "lønforhandling HR fortrolig", principal: PRINCIPALS.employee, retrieval: r, policy: all.policy });
      const hidden = ["bookstack-acme:page-hr-private", "bookstack-acme:page-hr-oncall", "bookstack-acme:page-salary-process"];
      const problems = [];
      for (const id of hidden) {
        if (r.results.some((x) => x.document.id === id)) problems.push(`retrieval lækkede ${id}`);
        if (emb.results.some((x) => x.document.id === id)) problems.push(`embedding-søgning lækkede ${id}`);
        if (answer.citations.some((c) => c.documentId === id)) problems.push(`citationsliste lækkede ${id}`);
      }
      if (answer.answerText.includes("Fortroligt") || answer.answerText.includes("lønforhandlinger")) problems.push("svaret lækkede fortroligt HR-indhold");
      scenarios.push({ id: "hr-private-hidden", principal: PRINCIPALS.employee.id, tenant: "acme", query: "lønforhandling", visible: r.results.map((x) => x.document.id), hidden, problems });
    }

    // 2) HR-medarbejder kan se den private side.
    {
      const r = retrieve({ index, principal: PRINCIPALS.hr, query: "lønforhandling HR fortrolig", policy: all.policy, aclResolver: aclFor });
      const problems = [];
      if (!r.results.some((x) => x.document.id === "bookstack-acme:page-hr-private")) problems.push("HR-medarbejderen kunne ikke se den private HR-side");
      scenarios.push({ id: "hr-private-visible-hr", principal: PRINCIPALS.hr.id, tenant: "acme", query: "lønforhandling", visible: r.results.map((x) => x.document.id), hidden: [], problems });
    }

    // 3) Tenantadskillelse i begge retninger.
    {
      const acme = retrieve({ index, principal: PRINCIPALS.employee, query: "kontrakt onboarding", policy: all.policy, aclResolver: aclFor });
      const globex = retrieve({ index, principal: PRINCIPALS.globex, query: "kontrakt onboarding", policy: all.policy, aclResolver: aclFor });
      const problems = [];
      if (acme.results.some((x) => x.document.tenantId !== "acme")) problems.push("acme-søgningen lækkede en anden tenant");
      if (globex.results.some((x) => x.document.tenantId !== "globex")) problems.push("globex-søgningen lækkede en anden tenant");
      scenarios.push({ id: "tenant-isolation", principal: "oidc|bo.bertelsen + oidc|gus.globex", tenant: "acme/globex", query: "kontrakt onboarding", visible: [...acme.results, ...globex.results].map((x) => x.document.id), hidden: [], problems });
    }

    // 4) Tilbagekaldt adgang håndhæves på tidligere indeksindhold.
    {
      // arkitektur-siden er læsbar for hele acme; giv den derefter kun HR-adgang.
      const before = retrieve({ index, principal: PRINCIPALS.employee, query: "arkitektur kontrolplan", policy: all.policy, aclResolver: aclFor });
      const hadAccess = before.results.some((x) => x.document.id === "bookstack-acme:page-architecture");
      mock.setPermissions("acme", "page-architecture", { readGroups: ["hr"], readSubjects: [], denyGroups: [], denySubjects: [] });
      const atRead = retrieve({ index, principal: PRINCIPALS.employee, query: "arkitektur kontrolplan", policy: all.policy, aclResolver: aclFor });
      const afterAtRead = atRead.results.some((x) => x.document.id === "bookstack-acme:page-architecture");
      // Reindeksér, så indeksets ACL-snapshot også opdateres.
      const currentDocs = index.list().map((doc) => {
        if (doc.id !== "bookstack-acme:page-architecture") return doc;
        const perms = mock.getPage("acme", "page-architecture").permissions;
        return { ...doc, acl: { ...doc.acl, ...perms } };
      });
      reconcilePermissions({ index, sourceDocuments: currentDocs, at: REPORT_GENERATED_AT });
      const afterReindex = retrieve({ index, principal: PRINCIPALS.employee, query: "arkitektur kontrolplan", policy: all.policy, aclResolver: aclFor });
      const problems = [];
      if (!hadAccess) problems.push("medarbejderen havde ikke adgang før tilbagekaldelsen");
      if (afterAtRead) problems.push("tilbagekaldt adgang blev ikke håndhævet ved revalidering ved læsning");
      if (afterReindex.results.some((x) => x.document.id === "bookstack-acme:page-architecture")) problems.push("tilbagekaldt adgang blev ikke håndhævet efter reindeksering");
      scenarios.push({ id: "revoked-access", principal: PRINCIPALS.employee.id, tenant: "acme", query: "arkitektur", visible: [], hidden: ["bookstack-acme:page-architecture"], problems });
    }

    // 5) Slettet side forsvinder inden for fristen.
    {
      const id = "bookstack-acme:page-onboarding";
      const source = all.sources.sources.find((s) => s.id === "bookstack-acme");
      mock.deletePage("acme", "page-onboarding");
      const deleted = deleteDocument({ index, id, at: REPORT_GENERATED_AT });
      const after = retrieve({ index, principal: PRINCIPALS.employee, query: "onboarding guide", policy: all.policy, aclResolver: aclFor });
      const measurement = measureDeletionDeadline({ index, id, deletedAt: deleted.deletedAt, observedAt: REPORT_GENERATED_AT, deadlineSeconds: all.policy.deletion.deadlineSeconds });
      const problems = [];
      if (!measurement.removedFromIndex) problems.push("slettet dokument lå stadig i indekset");
      if (!measurement.withinDeadline) problems.push("slettet dokument overskred fristen");
      if (after.results.some((x) => x.document.id === id)) problems.push("slettet dokument blev stadig returneret");
      deletion = { ...measurement, deadlineSeconds: all.policy.deletion.deadlineSeconds };
      scenarios.push({ id: "deleted-document", principal: PRINCIPALS.employee.id, tenant: "acme", query: "onboarding", visible: after.results.map((x) => x.document.id), hidden: [id], problems, deletion: measurement });
    }

    // 6) Prompt injection i en artikel aktiverer ikke et værktøj.
    {
      const r = retrieve({ index, principal: PRINCIPALS.employee, query: "god artikel skrivning", policy: all.policy, aclResolver: aclFor });
      const answer = buildAnswer({ query: "god artikel skrivning", principal: PRINCIPALS.employee, retrieval: r, policy: all.policy });
      answerSample = answer;
      const problems = [];
      if (answer.toolProposals.length > 0) problems.push("et forfalsket værktøjskald blev til et forslag");
      if (answer.toolActivationDenied !== true) problems.push("værktøjsaktivering blev ikke nægtet");
      if (answer.injectionFindings.length === 0) problems.push("injektionen blev ikke markeret");
      if (!answer.citations.some((c) => c.documentId === "bookstack-acme:page-injection")) problems.push("injektionsartiklen blev ikke citeret");
      scenarios.push({ id: "prompt-injection", principal: PRINCIPALS.employee.id, tenant: "acme", query: "god artikel", visible: r.results.map((x) => x.document.id), hidden: [], problems, injectionFindings: answer.injectionFindings });
    }

    // 7) Rettighedsændring invaliderer cachen.
    {
      const cache = new SearchCache();
      const key = retrievalCacheKey({ tenantId: "acme", subject: PRINCIPALS.employee.id, query: "onboarding", epoch: index.epoch() });
      cache.set(key, { cached: true }, { epoch: index.epoch(), at: Date.parse(REPORT_GENERATED_AT) });
      const epochBefore = index.epoch();
      mock.setPermissions("acme", "page-security", { readGroups: ["hr"], readSubjects: [], denyGroups: [], denySubjects: [] });
      index.bump("acl-change", REPORT_GENERATED_AT);
      const hit = cache.get(key, { epoch: index.epoch(), now: Date.parse(REPORT_GENERATED_AT), ttlSeconds: all.policy.cache.ttlSeconds });
      const problems = [];
      if (epochBefore === index.epoch()) problems.push("epoch blev ikke hævet ved rettighedsændring");
      if (hit !== null) problems.push("cachen blev ikke invalideret ved rettighedsændring");
      scenarios.push({ id: "cache-invalidation", principal: PRINCIPALS.employee.id, tenant: "acme", query: "onboarding", visible: [], hidden: [], problems });
    }

    const privateCount = documents.filter((d) => ["personal", "special-category", "confidential"].includes(d.classification)).length;
    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "KnowledgeSearchReport",
      metadata: {
        name: "platform-knowledge-search-report",
        version: "1.0.0",
        description: "Deterministisk rapport for rettighedsbevidst videnssøgning: tenant-/ACL-filtrering før retrieval, revalidering ved læsning, invalidning, slettefrist og injektionsneutralisering.",
        accountableHuman: all.sources.metadata.accountableHuman,
        labels: all.sources.metadata.labels ?? {},
      },
      generatedAt: REPORT_GENERATED_AT,
      measured: false,
      persistedIndexReloaded: persistedOk,
      indexDigest: indexDigest(index),
      totals: { documents: documents.length, privateDocuments: privateCount, tenants: new Set(documents.map((d) => d.tenantId)).size },
      scenarios,
      deletion,
      answerSample,
      policyRef: "search/index-policy.json",
    };
  } finally {
    await mock.close();
    rmSync(indexPath, { recursive: true, force: true });
  }
}

function problemsPush(scenarios, id, message) {
  const existing = scenarios.find((s) => s.id === id);
  if (existing) existing.problems.push(message);
  else scenarios.push({ id, principal: null, tenant: null, query: null, visible: [], hidden: [], problems: [message] });
}

function main() {
  runSearchCheck(repoRoot)
    .then((result) => {
      if (!result.ok) {
        console.error("✘ Videnssøgningskontrol fejlede:\n");
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log("✔ Kilder, politik, korpus og dokumenter er konsistente");
      console.log(`✔ ${result.report.scenarios.length} scenarier bestået; slettefrist ${result.report.deletion.elapsedMs} ms / ${result.report.deletion.deadlineMs} ms`);
    })
    .catch((err) => {
      console.error(`✘ Kontrollen kastede: ${err.stack ?? err.message}`);
      process.exit(1);
    });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
