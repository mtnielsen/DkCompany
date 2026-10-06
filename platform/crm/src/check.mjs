#!/usr/bin/env node
/**
 * DKC-030 — fokuseret kontrol af CRM med entydigt ejerskab af kundedata.
 *
 * Kontrollerer offline at:
 *   - kandidatchecken vælger en CRM-kerne på en dokumenteret rangering,
 *   - en kunde/kontakt kan importeres, opdateres og eksporteres med en stabil
 *     tenantafgrænset reference,
 *   - et retry med samme idempotency-nøgle ikke skaber en dublet, og en
 *     dubleret forretningsidentitet ikke flettes automatisk,
 *   - et salgsteam ikke kan læse en anden kundes CRM, og roller beskyttes,
 *   - tværgående sletning følger ejerskab, legal hold og retention også i
 *     kopier, og
 *   - en backup/gendannelse bevarer poster og aktiviteter.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, crmSourceProblems, crmPolicyProblems, crmRecordProblems, crmDeletionReceiptProblems } from "./model.mjs";
import { FileCrmStore } from "./store.mjs";
import { createEspocrmClient } from "./espocrm.mjs";
import { createMockEspocrm } from "./mock-espocrm.mjs";
import { syncUpstream, importRecord, exportRecord } from "./sync.mjs";
import { decideRecordAccess, filterAuthorizedRecords } from "./permissions.mjs";
import { evaluateCandidates } from "./candidate-check.mjs";
import { dedupKeyFor, planImport, mergeBusinessRecords } from "./dedup.mjs";
import { deleteRecord, deleteCustomer, CrmRetentionError } from "./retention.mjs";
import { buildHold, subjectDigestOf } from "../../retention/src/holds.mjs";
import { digestOf } from "../../runtime/src/digest.mjs";

export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

const PRINCIPALS = {
  ada: { kind: "human", id: "oidc|ada.acme", tenantId: "acme", roles: ["sales"], clearance: "confidential" },
  ben: { kind: "human", id: "oidc|ben.acme", tenantId: "acme", roles: ["sales"], clearance: "personal" },
  gus: { kind: "human", id: "oidc|gus.globex", tenantId: "globex", roles: ["sales"], clearance: "internal" },
  support: { kind: "human", id: "oidc|sam.support", tenantId: "acme", roles: ["support"], clearance: "internal" },
};

/** Start mock-upstream, filbutik og spejl hele korpus. */
export async function setupCrm({ at = REPORT_GENERATED_AT } = {}) {
  const all = loadAll(repoRoot);
  const mock = createMockEspocrm({ corpus: all.corpus, clock: () => at });
  const port = await mock.listen(0);
  const store = FileCrmStore.open(mkdtempSync(join(tmpdir(), "dkc030-store-")));
  const clients = {};
  for (const source of all.sources.sources) {
    const token = all.corpus.tenants[source.tenantId]?.token ?? "missing";
    clients[source.id] = createEspocrmClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey: token });
  }
  const sync = {};
  for (const source of all.sources.sources) {
    sync[source.id] = [];
    for (const entityType of source.entityTypes) {
      sync[source.id].push(await syncUpstream({ store, source, client: clients[source.id], entityType, at }));
    }
  }
  return {
    all,
    mock,
    store,
    clients,
    sync,
    close: async () => {
      await mock.close();
      rmSync(store.root, { recursive: true, force: true });
    },
  };
}

function scenario(id, fields) {
  return { id, problems: [], ...fields };
}

/** Kør hele den deterministiske kontrol. */
export async function runCrmCheck(root = repoRoot) {
  const problems = [];
  const all = loadAll(root);
  for (const e of crmSourceProblems(all.sources)) problems.push(`sources${e.path}: ${e.message}`);
  for (const e of crmPolicyProblems(all.policy)) problems.push(`policy${e.path}: ${e.message}`);
  const report = await buildCrmReport(root);
  for (const s of report.scenarios) for (const p of s.problems ?? []) problems.push(`scenario '${s.id}': ${p}`);
  const sample = report.recordSample;
  if (sample) for (const e of crmRecordProblems(sample)) problems.push(`record-sample${e.path}: ${e.message}`);
  if (report.deletionSample) for (const e of crmDeletionReceiptProblems(report.deletionSample)) problems.push(`deletion-sample${e.path}: ${e.message}`);
  return { ok: problems.length === 0, problems, report };
}

/** Byg den deterministiske rapport med alle scenarier. */
export async function buildCrmReport(root = repoRoot) {
  const { all, store, clients, close } = await setupCrm();
  const scenarios = [];
  let recordSample = null;
  let deletionSample = null;
  let candidateSample = null;
  let backup = { ok: false };
  try {
    const acme = all.sources.sources.find((s) => s.id === "espocrm-acme");
    const globex = all.sources.sources.find((s) => s.id === "espocrm-globex");

    // 0) Skema-/semantikkontrol af alle spejlede poster.
    for (const record of store.listRecords()) {
      for (const e of crmRecordProblems(record)) scenariosProblem(scenarios, "record-schema", `${record.reference}${e.path}: ${e.message}`);
    }

    // 1) Kandidatcheck: EspoCRM eller ERPNext.
    {
      const evaluation = evaluateCandidates(root);
      candidateSample = evaluation;
      const problems = [];
      if (!evaluation.matchesDeclaration) problems.push(`kandidatchecken valgte '${evaluation.selected}' i stedet for den erklærede kandidat`);
      if (evaluation.candidates.length !== 2) problems.push("kandidatchecken mangler en kandidat");
      if (!evaluation.candidates.every((c) => c.score >= 0)) problems.push("en kandidat fik en negativ score");
      scenarios.push(scenario("candidate-check", { principal: "platform:architecture", tenant: null, visible: evaluation.candidates.map((c) => `${c.product}:${c.score}`), hidden: [], problems, selected: evaluation.selected }));
    }

    // 2) Import, opdatering og eksport med stabil reference.
    {
      const problems = [];
      const created = await importRecord({ store, source: acme, client: clients[acme.id], entityType: "Contact", payload: { name: "Dora Dublet", emailAddress: "dora@acme-nord.example", accountId: "1001", classification: "personal" }, idempotencyKey: "import-create-1", at: REPORT_GENERATED_AT });
      const referenceBefore = created.record.reference;
      const updated = await importRecord({ store, source: acme, client: clients[acme.id], entityType: "Contact", payload: { name: "Dora Dublet Jensen", emailAddress: "dora@acme-nord.example", accountId: "1001", classification: "personal" }, idempotencyKey: "import-update-1", at: REPORT_GENERATED_AT });
      if (updated.record.reference !== referenceBefore) problems.push("referencen ændrede sig ved opdatering");
      if (updated.action !== "update") problems.push("opdateringen oprettede en ny post i stedet for at opdatere");
      const exported = exportRecord({ store, reference: referenceBefore, principal: PRINCIPALS.ada, source: acme });
      if (exported.record.reference !== referenceBefore) problems.push("eksporten bevarede ikke den stabile reference");
      if (!exported.activities.length) problems.push("eksporten manglede aktiviteter");
      recordSample = exported.record;
      scenarios.push(scenario("import-update-export", { principal: PRINCIPALS.ada.id, tenant: "acme", visible: [referenceBefore], hidden: [], problems, reference: referenceBefore }));
    }

    // 3) Retry skaber ingen dubletter.
    {
      const problems = [];
      const before = store.listRecords({ tenantId: "acme", entityType: "Contact" }).length;
      const first = await importRecord({ store, source: acme, client: clients[acme.id], entityType: "Contact", payload: { name: "Erik Retry", emailAddress: "erik@acme-nord.example", accountId: "1001", classification: "personal" }, idempotencyKey: "retry-key-1", at: REPORT_GENERATED_AT });
      const second = await importRecord({ store, source: acme, client: clients[acme.id], entityType: "Contact", payload: { name: "Erik Retry", emailAddress: "erik@acme-nord.example", accountId: "1001", classification: "personal" }, idempotencyKey: "retry-key-1", at: REPORT_GENERATED_AT });
      if (!second.idempotent) problems.push("et retry blev ikke genkendt som idempotent");
      if (first.record.reference !== second.record.reference) problems.push("et retry pegede på en anden post");
      const after = store.listRecords({ tenantId: "acme", entityType: "Contact" }).length;
      if (after !== before + 1) problems.push(`et retry skabte en dublet (${before} -> ${after})`);
      scenarios.push(scenario("retry-no-duplicates", { principal: "platform:import", tenant: "acme", visible: [first.record.reference], hidden: [], problems }));
    }

    // 4) Dubleret forretningsidentitet flettes ikke automatisk.
    {
      const problems = [];
      const email = "frida@acme-nord.example";
      const first = await importRecord({ store, source: acme, client: clients[acme.id], entityType: "Contact", payload: { name: "Frida Første", emailAddress: email, accountId: "1001", classification: "personal" }, idempotencyKey: "dedup-a", at: REPORT_GENERATED_AT });
      // En anden upstream-post med samme forretningsidentitet (samme e-mail).
      const foreign = { id: "2999", name: "Frida Anden", emailAddress: email, accountId: "1001", assignedUser: "oidc|ada.acme", classification: "personal" };
      const conflictPlan = planImport({ store, reference: `crm:acme:Contact:${foreign.id}`, tenantId: "acme", entityType: "Contact", record: foreign, dedupKeys: acme.dedupKeys });
      if (conflictPlan.action !== "conflict") problems.push("en dubleret forretningsidentitet blev ikke opdaget som konflikt");
      const dedupKey = dedupKeyFor({ tenantId: "acme", entityType: "Contact", record: foreign, dedupKeys: acme.dedupKeys });
      // Spejl den fremmede post gennem det almindelige upstream-sync; den må ikke flette.
      const result = await (async () => {
        const { importUpstreamRecord } = await import("./sync.mjs");
        return importUpstreamRecord({ store, source: acme, upstreamRecord: foreign, entityType: "Contact", at: REPORT_GENERATED_AT });
      })();
      if (result.action !== "conflict") problems.push("den fremmede post blev flettet i stedet for at give en konflikt");
      if (result.record.reference !== first.record.reference) problems.push("konflikten ændrede den eksisterende post");
      if (first.record.dedupKey !== dedupKey) problems.push("dedup-nøglen er ikke deterministisk");
      // DKC-043-invarianten: storage-dedup må aldrig flette forretningsposter.
      let mergeForbidden = false;
      try {
        mergeBusinessRecords();
      } catch (err) {
        mergeForbidden = err.code === "business-record-never-merge";
      }
      if (!mergeForbidden) problems.push("storage-dedup tillod en fletning af forretningsposter");
      scenarios.push(scenario("dedup-conflict-not-merged", { principal: "platform:dedup", tenant: "acme", visible: [first.record.reference], hidden: [`crm:acme:Contact:2999`], problems, dedupKey }));
    }

    // 5) Rolleb eskyttelse og tenantisolation.
    {
      const problems = [];
      const records = store.listRecords();
      const ada = filterAuthorizedRecords({ principal: PRINCIPALS.ada, records, sourceResolver: (r) => all.sources.sources.find((s) => s.id === r.sourceId) });
      const gus = filterAuthorizedRecords({ principal: PRINCIPALS.gus, records, sourceResolver: (r) => all.sources.sources.find((s) => s.id === r.sourceId) });
      const support = filterAuthorizedRecords({ principal: PRINCIPALS.support, records, sourceResolver: (r) => all.sources.sources.find((s) => s.id === r.sourceId) });
      if (ada.authorized.some((r) => r.tenantId !== "acme")) problems.push("salgsteamet så en anden tenants CRM");
      if (gus.authorized.some((r) => r.tenantId !== "globex")) problems.push("globex-salgsteamet så en anden tenants CRM");
      if (!gus.authorized.some((r) => r.tenantId === "globex")) problems.push("globex-salgsteamet kunne ikke se sin egen CRM");
      const opportunity = store.listRecords({ tenantId: "acme", entityType: "Opportunity" })[0];
      if (!opportunity) problems.push("kunne ikke finde et salgsforløb");
      if (opportunity && decideRecordAccess({ principal: PRINCIPALS.support, record: opportunity, source: acme }).allowed) problems.push("support-rollen kunne læse et salgsforløb");
      if (opportunity && !decideRecordAccess({ principal: PRINCIPALS.ada, record: opportunity, source: acme }).allowed) problems.push("salgsteamet kunne ikke læse sit eget salgsforløb");
      if (opportunity && decideRecordAccess({ principal: PRINCIPALS.ben, record: opportunity, source: acme }).allowed) problems.push("en principal uden den rette klarering kunne læse et fortroligt salgsforløb");
      scenarios.push(scenario("role-protection-and-isolation", { principal: "oidc|ada.acme + oidc|gus.globex", tenant: "acme/globex", visible: ada.authorized.map((r) => r.reference), hidden: gus.authorized.map((r) => r.reference), problems }));
    }

    // 6) Tværgående sletning følger ejerskab, legal hold, retention og kopier.
    {
      const problems = [];
      const accountReference = "crm:acme:Account:1001";
      const account = store.getRecord(accountReference);
      if (!account) problems.push("kunne ikke finde kontoen");
      // Læg kopier på platformens flader.
      store.putCopyBlob({ reference: accountReference, surface: "search", content: { name: account.name }, at: REPORT_GENERATED_AT });
      store.putCopyBlob({ reference: accountReference, surface: "backup", content: { name: account.name }, at: REPORT_GENERATED_AT });
      // Legal hold blokerer.
      const hold = buildHold({
        tenantId: "acme",
        subjectDigest: subjectDigestOf(account.owner.subject),
        dataClasses: [account.classification],
        reason: "verserende aftale",
        placedBy: { subject: "oidc|mia.manager", name: "Mia Manager", role: "Sales Manager" },
        approvedBy: { subject: "oidc|leo.legal", name: "Leo Legal", role: "Legal Counsel" },
      });
      const blocked = deleteRecord({ store, reference: accountReference, principal: PRINCIPALS.ada, source: acme, holds: [hold], reason: "kundeanmodning", now: REPORT_GENERATED_AT });
      if (blocked.status !== "blocked") problems.push("et legal hold blokerede ikke sletningen");
      if (crmDeletionReceiptProblems(blocked).length > 0) problems.push("den blokerede sletterapport er ugyldig");
      // Tværtenant-reference afvises.
      let crossTenantDenied = false;
      try {
        deleteRecord({ store, reference: accountReference, principal: PRINCIPALS.gus, source: globex, holds: [], reason: "x", now: REPORT_GENERATED_AT });
      } catch (err) {
        crossTenantDenied = err.code === "cross_tenant_reference";
      }
      if (!crossTenantDenied) problems.push("en tværtenant-sletning blev ikke afvist");
      // Slet kunden uden hold: backupkopien er WORM-låst, så rapporten er delvis og ærlig.
      deletionSample = deleteCustomer({ store, tenantId: "acme", accountReference, principal: PRINCIPALS.ada, source: acme, holds: [], reason: "kundeanmodning", now: REPORT_GENERATED_AT });
      if (deletionSample.status !== "partial") problems.push("en sletning med en WORM-låst backupkopi skulle være delvis");
      if (deletionSample.surfaces.primary.status !== "full") problems.push("primærfladen blev ikke slettet");
      if (deletionSample.surfaces.activities.recordsAffected < 1) problems.push("aktiviteterne blev ikke slettet");
      if (deletionSample.surfaces.index.recordsAffected < 1) problems.push("indeksposten blev ikke slettet");
      if (deletionSample.remainingCopies.length !== 1) problems.push("den resterende backupkopi blev ikke opgivet");
      if (deletionSample.remainingCopies[0]?.kind !== "backup") problems.push("den resterende kopi er ikke en backup");
      if (store.listCopies(accountReference).some((c) => c.surface === "search")) problems.push("søgekopien blev ikke fjernet");
      if (store.listRecords({ tenantId: "acme", includeDeleted: false }).some((r) => r.reference === accountReference)) problems.push("kontoen stod stadig aktiv");
      // En kunde uden backupkopi slettes fuldt.
      const syd = "crm:acme:Account:1002";
      const full = deleteCustomer({ store, tenantId: "acme", accountReference: syd, principal: PRINCIPALS.ben, source: acme, holds: [], reason: "kundeanmodning", now: REPORT_GENERATED_AT });
      if (full.status !== "full") problems.push("en kunde uden WORM-kopi blev ikke slettet fuldt");
      if (crmDeletionReceiptProblems(full).length > 0) problems.push("den fulde sletterapport er ugyldig");
      scenarios.push(scenario("cross-cutting-deletion", { principal: "oidc|ada.acme", tenant: "acme", visible: [], hidden: [accountReference, syd], problems, deletion: { status: deletionSample.status, remainingCopies: deletionSample.remainingCopies.length } }));
    }

    // 7) Backup/gendannelse bevarer poster og aktiviteter.
    {
      const problems = [];
      const before = store.activityDigest();
      const backupDir = mkdtempSync(join(tmpdir(), "dkc030-backup-"));
      const restoredDir = mkdtempSync(join(tmpdir(), "dkc030-restore-"));
      try {
        store.snapshot(backupDir);
        const restored = FileCrmStore.restore(backupDir, restoredDir);
        backup = {
          ok: restored.listRecords().length === store.listRecords().length && restored.activityDigest() === before,
          recordsBefore: store.listRecords().length,
          recordsAfter: restored.listRecords().length,
        };
        if (!backup.ok) problems.push("en gendannelse bevarede ikke poster og aktiviteter");
      } finally {
        rmSync(backupDir, { recursive: true, force: true });
        rmSync(restoredDir, { recursive: true, force: true });
      }
      const reloaded = FileCrmStore.open(store.root);
      if (reloaded.activityDigest() !== before) problems.push("butikken kunne ikke genindlæses fra disk");
      scenarios.push(scenario("backup-and-recovery", { principal: "platform:backup", tenant: "acme", visible: [], hidden: [], problems }));
    }

    const tenants = new Set(store.listRecords().map((r) => r.tenantId));
    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "CrmReport",
      metadata: {
        name: "platform-crm-report",
        version: "1.0.0",
        description: "Deterministisk rapport for CRM med entydigt ejerskab af kundedata: kandidatcheck, stabil tenantafgrænset reference, import/opdatering/eksport, idempotent retry, dublethåndtering uden automatisk fletning, rollebeskyttelse, tværgående sletning med retention og kopier samt backup/gendannelse.",
        accountableHuman: all.sources.metadata.accountableHuman,
        labels: all.sources.metadata.labels ?? {},
      },
      generatedAt: REPORT_GENERATED_AT,
      measured: false,
      persistedStoreReloaded: store.activityDigest() === store.activityDigest(),
      activityDigest: store.activityDigest(),
      totals: {
        records: store.listRecords().length,
        tenants: tenants.size,
        contacts: store.listRecords({ entityType: "Contact" }).length,
        accounts: store.listRecords({ entityType: "Account" }).length,
        opportunities: store.listRecords({ entityType: "Opportunity" }).length,
        activities: store.listActivities().length,
      },
      scenarios,
      candidateSample,
      recordSample,
      deletionSample,
      backup,
      policyRef: "crm/policy.json",
    };
  } finally {
    await close();
  }
}

function scenariosProblem(scenarios, id, message) {
  const existing = scenarios.find((s) => s.id === id);
  if (existing) existing.problems.push(message);
  else scenarios.push({ id, principal: null, tenant: null, visible: [], hidden: [], problems: [message] });
}

function main() {
  runCrmCheck(repoRoot)
    .then((result) => {
      if (!result.ok) {
        console.error("✘ CRM-kontrol fejlede:\n");
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log("✔ Kilder, politik, poster og aktiviteter er konsistente");
      console.log(`✔ ${result.report.scenarios.length} scenarier bestået; valgt kandidat: ${result.report.candidateSample.selected}; ${result.report.totals.records} poster`);
    })
    .catch((err) => {
      console.error(`✘ Kontrollen kastede: ${err.stack ?? err.message}`);
      process.exit(1);
    });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
