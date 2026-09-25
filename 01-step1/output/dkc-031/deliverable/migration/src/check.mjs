#!/usr/bin/env node
/**
 * DKC-031 — fokuseret, deterministisk kontrol af migrations- og exitværktøjer.
 *
 * Kontrollerer offline at:
 *   - hver pilotapp har ét valgt, dokumenteret kildeformat og en fuld
 *     dækningsmatrix, og at tabt funktionalitet vises før cutover,
 *   - en dry-run afstemmer antal og checksums,
 *   - en import er resumabel og idempotent, så et retry eller en genoptagelse
 *     ikke skaber dubletter, og en dubleret forretningsidentitet bliver en
 *     konflikt frem for en automatisk fletning,
 *   - exit-eksporten kan læses af et standalone script uden platformen,
 *   - en cutover kræver en afstemt import og en menneskelig pilotgodkendelse af
 *     både indhold og adgangsrettigheder, og at en rollback gendanner poster og
 *     rettigheder, og
 *   - adgang er default-deny og tenantadskilt.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, migrationSourceProblems, migrationPolicyProblems, migrationCoverageProblems, migrationReconciliationProblems, migrationExportProblems, migrationApprovalProblems, migrationRecordProblems } from "./model.mjs";
import { buildCoverage, lostFunctionalityFor } from "./coverage.mjs";
import { FileMigrationStore } from "./store.mjs";
import { dryRun, importBatch, reconcile } from "./import.mjs";
import { buildExport, writeExport } from "./export.mjs";
import { decideMigrationAccess } from "./permissions.mjs";
import { recordApproval, MigrationApprovalError } from "./approval.mjs";
import { planCutover, executeCutover, rollbackCutover } from "./cutover.mjs";
import { mergeBusinessRecords } from "./dedup.mjs";

export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

const PRINCIPALS = {
  ada: { kind: "human", id: "oidc|ada.acme", name: "Ada Acme", tenantId: "acme", roles: ["content-admin", "crm-admin", "project-admin", "knowledge-admin", "support-admin"], clearance: "confidential" },
  ben: { kind: "human", id: "oidc|ben.acme", name: "Ben Acme", tenantId: "acme", roles: ["content-auditor"], clearance: "internal" },
  gus: { kind: "human", id: "oidc|gus.globex", name: "Gus Globex", tenantId: "globex", roles: ["crm-admin"], clearance: "internal" },
  operator: { kind: "human", id: "oidc|ola.operator", name: "Ola Operator", tenantId: "acme", roles: ["platform-admin:acme"], clearance: "internal" },
};

/** Start en tom filbutik og indlæs kilder, politik, korpus og dækningsmatrix. */
export function setupMigration({ at = REPORT_GENERATED_AT } = {}) {
  const all = loadAll(repoRoot);
  const coverage = buildCoverage({ sources: all.sources, at });
  const store = FileMigrationStore.open(mkdtempSync(join(tmpdir(), "dkc031-store-")));
  return {
    all,
    coverage,
    store,
    cleanup: () => rmSync(store.root, { recursive: true, force: true }),
  };
}

function sourceById(all, id) {
  const source = all.sources.sources.find((s) => s.id === id);
  if (!source) throw new Error(`kilden '${id}' findes ikke`);
  return source;
}

function objectsFor(all, source) {
  return all.corpus.objects.filter((o) => o.appId === source.appId && o.tenantId === source.tenantId);
}

function scenario(id, fields) {
  return { id, problems: [], ...fields };
}

export async function runMigrationCheck(root = repoRoot) {
  const problems = [];
  const all = loadAll(root);
  for (const e of migrationSourceProblems(all.sources)) problems.push(`sources${e.path}: ${e.message}`);
  for (const e of migrationPolicyProblems(all.policy)) problems.push(`policy${e.path}: ${e.message}`);
  const coverage = buildCoverage({ sources: all.sources, at: REPORT_GENERATED_AT });
  for (const e of migrationCoverageProblems(coverage, { sources: all.sources.sources })) problems.push(`coverage${e.path}: ${e.message}`);
  const report = await buildMigrationReport(root);
  for (const s of report.scenarios) for (const p of s.problems ?? []) problems.push(`scenario '${s.id}': ${p}`);
  for (const rec of report.sourceSummaries) {
    for (const e of migrationReconciliationProblems(rec.reconciliation)) problems.push(`reconciliation '${rec.sourceId}'${e.path}: ${e.message}`);
  }
  if (report.exportSample) {
    for (const e of migrationExportProblems(report.exportSample)) problems.push(`export${e.path}: ${e.message}`);
  }
  if (report.approvalSample) {
    for (const e of migrationApprovalProblems(report.approvalSample, { tenantId: "acme", appId: "files" })) problems.push(`approval${e.path}: ${e.message}`);
  }
  if (report.recordSample) for (const e of migrationRecordProblems(report.recordSample)) problems.push(`record${e.path}: ${e.message}`);
  return { ok: problems.length === 0, problems, report };
}

export async function buildMigrationReport(root = repoRoot) {
  const { all, coverage, store, cleanup } = setupMigration();
  const scenarios = [];
  let recordSample = null;
  let exportSample = null;
  let approvalSample = null;
  let cutoverSample = null;
  const sourceSummaries = [];
  const cutoverDir = mkdtempSync(join(tmpdir(), "dkc031-cutover-"));
  const rollbackDir = mkdtempSync(join(tmpdir(), "dkc031-rollback-"));
  try {
    // 1) Kilder, politik og dækningsmatrix.
    {
      const problems = [];
      if (new Set(all.sources.sources.map((s) => `${s.tenantId}:${s.appId}`)).size !== all.sources.sources.length) {
        problems.push("en pilotapp har mere end ét kildeformat for samme tenant");
      }
      for (const app of ["files", "projects", "knowledge", "support", "crm"]) {
        if (!all.sources.sources.some((s) => s.appId === app)) problems.push(`pilotappen '${app}' mangler`);
      }
      scenarios.push(scenario("chosen-source-format-per-pilot-app", { principal: "platform:migration", tenant: "acme", visible: all.sources.sources.map((s) => `${s.appId}:${s.format.id}@${s.format.version}`), hidden: [], problems }));
    }

    // 2) Dækningsmatrix med tabt funktionalitet.
    {
      const problems = [];
      if (coverage.matrix.length !== all.sources.sources.reduce((sum, s) => sum + (s.entityTypes ?? []).length * 6, 0)) {
        problems.push("dækningsmatricen dækker ikke alle app/entitet/facet-kombinationer");
      }
      if (coverage.lostFunctionality.length === 0) problems.push("der blev ikke fundet nogen tabt funktionalitet at vise");
      for (const entry of coverage.lostFunctionality) if (!entry.note) problems.push(`'${entry.appId}:${entry.facet}' mangler en forklaring`);
      scenarios.push(scenario("coverage-matrix-shows-lost-functionality", { principal: "platform:migration", tenant: "acme", visible: coverage.lostFunctionality.map((e) => `${e.appId}:${e.entityType}:${e.facet}`), hidden: [], problems, summary: coverage.summary }));
    }

    // 3) Dry-run afstemmer antal og checksums.
    for (const source of all.sources.sources) {
      const objects = objectsFor(all, source);
      const dry = dryRun({ source, objects, coverage, at: REPORT_GENERATED_AT });
      if (!dry.checksums.match) scenariosProblem(scenarios, "dry-run-reconciles", `'${source.id}': checksums afstemmer ikke`);
      if (!dry.persisted && dry.counts.created + dry.counts.conflicts + dry.counts.failed !== dry.counts.source) {
        scenariosProblem(scenarios, "dry-run-reconciles", `'${source.id}': klassificeringen afstemmer ikke med kildeantallet`);
      }
      sourceSummaries.push({ sourceId: source.id, appId: source.appId, tenantId: source.tenantId, format: `${source.format.id}@${source.format.version}`, objects: objects.length, reconciliation: dry });
    }
    scenarios.push(scenario("dry-run-reconciles", { principal: "platform:migration", tenant: "acme", visible: sourceSummaries.map((s) => `${s.sourceId}:${s.reconciliation.counts.source}`), hidden: [], problems: [] }));

    // 4) Resumabel og idempotent import uden dubletter.
    {
      const problems = [];
      const source = sourceById(all, "files-acme");
      const objects = objectsFor(all, source);
      const first = importBatch({ store, source, objects, coverage, at: REPORT_GENERATED_AT, limit: 1 });
      if (first.counts.created + first.counts.updated !== 1) problems.push("den afbrudte import importerede ikke præcis ét objekt");
      const second = importBatch({ store, source, objects, coverage, at: REPORT_GENERATED_AT, resume: true });
      const total = store.listRecords({ tenantId: "acme", appId: "files" }).length;
      if (total !== objects.length) problems.push(`den genoptagne import gav ${total} poster i stedet for ${objects.length}`);
      const retry = importBatch({ store, source, objects, coverage, at: REPORT_GENERATED_AT, resume: false });
      const afterRetry = store.listRecords({ tenantId: "acme", appId: "files" }).length;
      if (afterRetry !== objects.length) problems.push(`et retry skabte dubletter (${afterRetry} != ${objects.length})`);
      if (retry.counts.created !== 0) problems.push("et retry oprettede nye poster");
      if (second.counts.conflicts !== 0) problems.push("den genoptagne import gav en konflikt");
      scenarios.push(scenario("resumable-idempotent-import", { principal: "oidc|ada.acme", tenant: "acme", visible: store.listRecords({ tenantId: "acme", appId: "files" }).map((r) => r.reference), hidden: [], problems }));
    }

    // 5) Dubletkonflikt flettes ikke automatisk.
    {
      const problems = [];
      const source = sourceById(all, "crm-acme");
      const objects = objectsFor(all, source);
      const dry = dryRun({ source, objects, coverage, at: REPORT_GENERATED_AT });
      if (dry.counts.conflicts !== 1) problems.push(`dry-run fandt ${dry.counts.conflicts} konflikter i stedet for 1`);
      const before = store.listRecords({ tenantId: "acme", appId: "crm" }).length;
      const result = importBatch({ store, source, objects, coverage, at: REPORT_GENERATED_AT });
      const after = store.listRecords({ tenantId: "acme", appId: "crm" }).length;
      if (result.counts.conflicts !== 1) problems.push("importen registrerede ikke dubletkonflikten");
      if (after !== before + 1) problems.push(`konflikten ændrede antallet af poster (${before} -> ${after})`);
      let mergeForbidden = false;
      try {
        mergeBusinessRecords();
      } catch (error) {
        mergeForbidden = error.code === "business-record-never-merge";
      }
      if (!mergeForbidden) problems.push("storage-dedup tillod en fletning af forretningsposter");
      scenarios.push(scenario("dedup-conflict-not-merged", { principal: "platform:import", tenant: "acme", visible: store.listRecords({ tenantId: "acme", appId: "crm" }).map((r) => r.reference), hidden: dry.conflicts.map((c) => c.existingReference), problems }));
    }

    // 6) Exit-eksport kan læses uden platformen.
    {
      const problems = [];
      const source = sourceById(all, "files-acme");
      const objects = objectsFor(all, source);
      importBatch({ store, source, objects, coverage, at: REPORT_GENERATED_AT });
      const exported = buildExport({ store, tenantId: "acme", appId: "files", coverage, at: REPORT_GENERATED_AT });
      const written = writeExport({ dir: join(store.root, "export-files"), exported });
      exportSample = written.manifest;
      recordSample = { ...exported.records[0], dedupKey: exported.records[0].dedupKey ?? null };
      // Rekvirer et objekt uden dedupKey i recordSample ved at tage det fra butikken.
      recordSample = store.getRecord(exported.records[0].reference);
      try {
        const output = execFileSync(process.execPath, [join(written.dir, "read-export.mjs"), written.dir], { encoding: "utf8" });
        if (!/kan læses uden DkCompany/.test(output)) problems.push("standalone-læseren bekræftede ikke eksporten");
      } catch (error) {
        problems.push(`standalone-læseren fejlede: ${error.message}`);
      }
      if (exportSample.files.length !== 4) problems.push("eksporten mangler dokumenterede filer");
      if (!exportSample.includes.acl || !exportSample.includes.comments) problems.push("eksporten mangler facetter");
      if (exportSample.recordCount !== objects.length) problems.push("eksportens antal stemmer ikke");
      scenarios.push(scenario("exit-export-readable-without-platform", { principal: "oidc|ada.acme", tenant: "acme", visible: exportSample.files.map((f) => f.path), hidden: [], problems }));
    }

    // 7) Pilotgodkendelse af indhold og adgangsrettigheder.
    {
      const problems = [];
      const source = sourceById(all, "files-acme");
      let rejectedSelfApproval = false;
      try {
        recordApproval({ store, principal: PRINCIPALS.operator, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://pilot/files", operatorSubject: PRINCIPALS.operator.id, at: REPORT_GENERATED_AT });
      } catch (error) {
        rejectedSelfApproval = error instanceof MigrationApprovalError && error.code === "invalid_approval";
      }
      if (!rejectedSelfApproval) problems.push("operatøren kunne godkende sin egen migration");
      let rejectedMissingAcl = false;
      try {
        recordApproval({ store, principal: PRINCIPALS.ada, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: false, evidenceRef: "evidence://pilot/files", at: REPORT_GENERATED_AT });
      } catch (error) {
        rejectedMissingAcl = error instanceof MigrationApprovalError;
      }
      if (!rejectedMissingAcl) problems.push("en godkendelse uden ACL-godkendelse blev accepteret");
      approvalSample = recordApproval({ store, principal: PRINCIPALS.ada, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://pilot/files", at: REPORT_GENERATED_AT });
      if (!approvalSample.contentApproved || !approvalSample.aclApproved) problems.push("godkendelsen mangler indhold/ACL");
      scenarios.push(scenario("pilot-approves-content-and-acl", { principal: PRINCIPALS.ada.id, tenant: "acme", visible: [approvalSample.evidenceRef], hidden: [], problems }));
    }

    // 8) Cutover kræver afstemning og godkendelse; rollback gendanner.
    {
      const problems = [];
      const source = sourceById(all, "files-acme");
      const objects = objectsFor(all, source);
      const objectsForRecon = objectsFor(all, source);
      const reconciliation = reconcile({ store, source, objects: objectsForRecon, coverage, at: REPORT_GENERATED_AT });
      if (!reconciliation.checksums.match) problems.push("import-afstemningen matcher ikke");
      const plan = planCutover({ store, source, reconciliation, operatorSubject: PRINCIPALS.operator.id });
      if (plan.status !== "ready") problems.push(`cutover-planen er '${plan.status}': ${plan.problems.map((p) => p.message).join("; ")}`);
      if (plan.coverageLosses.length === 0) problems.push("cutover-planen viser ikke den tabte funktionalitet");
      const before = store.listRecords({ tenantId: "acme", appId: "files" }).length;
      const receipt = executeCutover({ store, source, principal: PRINCIPALS.ada, reconciliation, operatorSubject: PRINCIPALS.operator.id, at: REPORT_GENERATED_AT, snapshotDir: cutoverDir });
      const rolled = rollbackCutover({ store, receipt, destDir: rollbackDir, at: REPORT_GENERATED_AT });
      if (rolled.status !== "rolled-back") problems.push("rollback blev ikke gennemført");
      if (rolled.records !== before) problems.push(`rollback gendannede ${rolled.records} poster i stedet for ${before}`);
      const restricted = decideMigrationAccess({ principal: PRINCIPALS.ben, source, action: "import" });
      if (restricted.allowed) problems.push("en læserolle kunne importere");
      scenarios.push(scenario("cutover-requires-approval-and-rollback", { principal: PRINCIPALS.ada.id, tenant: "acme", visible: [receipt.status, rolled.status], hidden: [], problems, lostFunctionality: plan.lostFunctionality }));
      cutoverSample = { status: receipt.status, rollback: rolled.status, coverageLosses: plan.coverageLosses.length, lostFunctionality: plan.lostFunctionality };
    }

    // 9) Tenantisolation og default-deny.
    {
      const problems = [];
      const files = sourceById(all, "files-acme");
      const crm = sourceById(all, "crm-globex");
      if (decideMigrationAccess({ principal: PRINCIPALS.gus, source: files, action: "read" }).allowed) problems.push("globex læste acme's filer");
      if (!decideMigrationAccess({ principal: PRINCIPALS.gus, source: crm, action: "read" }).allowed) problems.push("globex kunne ikke læse sin egen CRM");
      if (decideMigrationAccess({ principal: null, source: files, action: "read" }).allowed) problems.push("en manglende principal fik adgang");
      if (!decideMigrationAccess({ principal: PRINCIPALS.ada, source: files, action: "read" }).allowed) problems.push("acme kunne ikke læse sine egne filer");
      scenarios.push(scenario("tenant-isolation-default-deny", { principal: "oidc|gus.globex", tenant: "globex", visible: ["crm-globex"], hidden: ["files-acme"], problems }));
    }

    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "MigrationReport",
      metadata: {
        name: "platform-migration-report",
        version: "1.0.0",
        description: "Deterministisk rapport for migrations- og exitværktøjer: ét valgt kildeformat pr. pilotapp, dækningsmatrix med tabt funktionalitet, dry-run med afstemning, resumabel og idempotent import, dublethåndtering uden automatisk fletning, selvbeskrivende exit-eksport, pilotgodkendelse, cutover og rollback samt tenantisolation.",
        accountableHuman: all.sources.metadata.accountableHuman,
        labels: all.sources.metadata.labels ?? {},
      },
      generatedAt: REPORT_GENERATED_AT,
      measured: false,
      policyRef: "migration/policy.json",
      totals: {
        pilotApps: new Set(all.sources.sources.map((s) => s.appId)).size,
        sources: all.sources.sources.length,
        tenants: new Set(all.sources.sources.map((s) => s.tenantId)).size,
        records: store.listRecords().length,
        lostFacets: coverage.lostFunctionality.length,
      },
      coverage,
      sourceSummaries,
      scenarios,
      recordSample,
      exportSample,
      approvalSample,
      cutoverSample,
    };
  } finally {
    rmSync(cutoverDir, { recursive: true, force: true });
    rmSync(rollbackDir, { recursive: true, force: true });
    cleanup();
  }
}

function scenariosProblem(scenarios, id, message) {
  const existing = scenarios.find((s) => s.id === id);
  if (existing) existing.problems.push(message);
  else scenarios.push({ id, principal: null, tenant: null, visible: [], hidden: [], problems: [message] });
}

function main() {
  runMigrationCheck(repoRoot)
    .then((result) => {
      if (!result.ok) {
        console.error("✘ Migrationskontrol fejlede:\n");
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log("✔ Kilder, politik, dækningsmatrix, dry-run, import, eksport, godkendelse og cutover er konsistente");
      console.log(`✔ ${result.report.scenarios.length} scenarier bestået; ${result.report.totals.pilotApps} pilotapps, ${result.report.totals.sources} kilder, ${result.report.totals.lostFacets} tabte facetter`);
    })
    .catch((error) => {
      console.error(`✘ Kontrollen kastede: ${error.stack ?? error.message}`);
      process.exit(1);
    });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
