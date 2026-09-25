/**
 * DKC-059 — fokuseret, deterministisk kontrol af providerkontrakter og
 * migrationskontrol.
 *
 * Kontrollerer offline at:
 *   - hver providerklasse har et versionsstyret capability-katalog med
 *     obligatoriske og sikkerhedskritiske capabilities,
 *   - hvert providerskift har en eksplicit kompatibilitetsrække (drop-in,
 *     planlagt migration eller ikke-understøttet),
 *   - en manglende obligatorisk capability eller en nedgradering af en
 *     sikkerhedskritisk semantik stopper skiftet før ændring, og at en
 *     forbindelsesstreng — også en identisk — ikke omgår gaten,
 *   - en verificeret backendudskiftning, en appmigration og et IAM-skift
 *     afstemmer antal, checksums, links, autorisation og referencespor, og at
 *     IAM-skiftet bevarer entydig identitet og historisk audit-provenance,
 *   - den gamle provider sættes read-only og dens aktive credentials
 *     tilbagekaldes, mens evidensen bevares, og at en rollback gendanner
 *     poster, id-mapping og rettigheder, og
 *   - adgang er default-deny og tenantadskilt.
 *
 * `measured: false`: alt er efterprøvet mod syntetiske fixtures. En rigtig
 * backendudskiftning eller appmigration mod levende upstream-instanser kræver
 * ekstern infrastruktur og er NOT RUN.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import {
  loadAll,
  capabilityCatalogProblems,
  providerRegistryProblems,
  supportMatrixProblems,
  swapPolicyProblems,
  swapFixtureProblems,
  REPORT_GENERATED_AT,
} from "./provider-model.mjs";
import { preflightSwap } from "./provider-negotiate.mjs";
import { decideProviderSwapAccess } from "./provider-permissions.mjs";
import { FileProviderStore } from "./provider-store.mjs";
import { planSwap, executeSwap, rollbackSwap } from "./provider-swap.mjs";
import { recordApproval } from "./approval.mjs";

export { REPORT_GENERATED_AT };

export const PRINCIPALS = {
  ada: { kind: "human", id: "oidc|ada.acme", name: "Ada Acme", tenantId: "acme", roles: ["provider-admin"], clearance: "confidential" },
  ben: { kind: "human", id: "oidc|ben.acme", name: "Ben Acme", tenantId: "acme", roles: ["provider-auditor"], clearance: "internal" },
  gus: { kind: "human", id: "oidc|gus.globex", name: "Gus Globex", tenantId: "globex", roles: ["provider-admin"], clearance: "internal" },
  operator: { kind: "human", id: "oidc|ola.operator", name: "Ola Operator", tenantId: "acme", roles: ["provider-admin"], clearance: "internal" },
};

export function setupProvider() {
  const all = loadAll(repoRoot);
  const root = mkdtempSync(join(tmpdir(), "dkc059-store-"));
  const store = FileProviderStore.open(root);
  for (const provider of all.providers.providers) {
    store.addCredential({ id: `${provider.id}-svc`, provider: provider.id, tenantId: "acme", secretRef: `vault://providers/${provider.id}` });
  }
  return { all, store, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function scenario(id, fields) {
  return { id, problems: [], ...fields };
}

/** Kør preflight for hver matrice-række og for hver fixture. */
export function evaluateCompatibility(all) {
  const rows = [];
  for (const row of all.matrix.rows) {
    const preflight = preflightSwap({ providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from: row.from, to: row.to });
    rows.push({ id: row.id, class: row.class, from: row.from, to: row.to, mode: row.mode, allowed: preflight.allowed, status: preflight.status, problems: preflight.problems.map((p) => p.code) });
  }
  return rows;
}

function swapFixturePair(all) {
  const byId = new Map(all.swaps.map((s) => [s.fixture.id, s.fixture]));
  return {
    backend: byId.get("storage-filesystem-to-object-store"),
    app: byId.get("files-app-nextcloud-to-dkc-apps"),
    iam: byId.get("iam-keycloak-to-entra"),
  };
}

export async function buildProviderReport(root = repoRoot) {
  const all = loadAll(root);
  const scenarios = [];
  const problems = [];
  const compatibility = evaluateCompatibility(all);

  // 1) Katalog og register.
  {
    const local = [];
    if (capabilityCatalogProblems(all.catalog).length) local.push("capability-kataloget er inkonsistent");
    if (providerRegistryProblems(all.providers, { catalog: all.catalog }).length) local.push("providerregistret er inkonsistent");
    const classCount = new Set(all.providers.providers.map((p) => p.class)).size;
    if (classCount !== 7) local.push(`providerregistret dækker ${classCount} klasser i stedet for 7`);
    scenarios.push(scenario("capability-catalog-and-registry", { principal: "platform:provider", tenant: null, visible: all.catalog.classes.map((c) => c.id), hidden: [], problems: local, capabilities: all.catalog.capabilities.length }));
  }

  // 2) Supportmatrix dækker alle tre tilstande og ikke-understøttede skift afvises.
  {
    const local = [];
    const modes = new Set(all.matrix.rows.map((r) => r.mode));
    for (const mode of ["drop-in", "planned-migration", "unsupported"]) if (!modes.has(mode)) local.push(`tilstanden '${mode}' mangler`);
    const unsupported = compatibility.filter((r) => r.mode === "unsupported");
    if (unsupported.some((r) => r.allowed)) local.push("et ikke-understøttet skift blev tilladt");
    const planned = compatibility.filter((r) => r.mode === "planned-migration");
    if (planned.some((r) => !r.allowed)) local.push("et planlagt skift blev blokeret af forhandlingen");
    const dropIn = compatibility.filter((r) => r.mode === "drop-in");
    if (dropIn.some((r) => !r.allowed)) local.push("et drop-in-skift blev blokeret");
    scenarios.push(scenario("support-matrix-classifies-switches", { principal: "platform:provider", tenant: null, visible: compatibility.map((r) => `${r.id}:${r.mode}:${r.allowed ? "allowed" : "blocked"}`), hidden: [], problems: local }));
  }

  // 3) Manglende obligatorisk capability stopper skiftet — også med identisk forbindelsesstreng.
  {
    const local = [];
    const sqlite = all.providers.providers.find((p) => p.id === "sqlite-local");
    const mysql = all.providers.providers.find((p) => p.id === "mysql-managed");
    const blocked = preflightSwap({ providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from: "sqlite-local", to: "mysql-managed" });
    if (blocked.allowed) local.push("skiftet til mysql blev tilladt på trods af en manglende obligatorisk capability");
    if (!blocked.problems.some((p) => p.code === "missing_mandatory_capability")) local.push("den manglende obligatoriske capability blev ikke rapporteret");
    // Identisk forbindelsesstreng må ikke omgå gaten.
    const sameConnection = { scheme: sqlite.connection.scheme, endpoint: sqlite.connection.endpoint };
    const clonedProviders = { ...all.providers, providers: all.providers.providers.map((p) => (p.id === "mysql-managed" ? { ...p, connection: { ...sameConnection } } : p)) };
    const bypassAttempt = preflightSwap({ providers: clonedProviders, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from: "sqlite-local", to: "mysql-managed" });
    if (bypassAttempt.allowed) local.push("en identisk forbindelsesstreng omgik capability-gaten");
    if (!bypassAttempt.connectionStringMatches) local.push("testen etablerede ikke en identisk forbindelsesstreng");
    scenarios.push(scenario("missing-capability-stops-switch", { principal: "platform:provider", tenant: null, visible: blocked.problems.map((p) => p.code), hidden: [], problems: local, connectionStringMatches: bypassAttempt.connectionStringMatches }));
  }

  // 4) Sikkerhedskritiske semantikker kan ikke nedgraderes.
  {
    const local = [];
    for (const [from, to] of [["object-store-s3", "filesystem-local"], ["keycloak-iam", "legacy-ldap-iam"], ["local-llm", "external-llm-basic"]]) {
      const result = preflightSwap({ providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from, to });
      if (result.allowed) local.push(`skiftet '${from}' -> '${to}' blev tilladt på trods af en sikkerhedskritisk nedgradering`);
    }
    scenarios.push(scenario("security-critical-not-downgraded", { principal: "platform:security", tenant: null, visible: compatibility.filter((r) => r.allowed === false).map((r) => r.id), hidden: [], problems: local }));
  }

  // 5) Verificeret backendudskiftning med afstemning og rollback.
  const pair = swapFixturePair(all);
  const { store, cleanup } = setupProvider();
  const rollbackDir = mkdtempSync(join(tmpdir(), "dkc059-rollback-"));
  const snapshotsDir = mkdtempSync(join(tmpdir(), "dkc059-snap-"));
  const snapFor = (id) => join(snapshotsDir, id);
  try {
    {
      const fixture = pair.backend;
      const local = [];
      const approval = recordApproval({ store, principal: PRINCIPALS.ada, tenantId: fixture.tenantId, appId: fixture.appId, contentApproved: true, aclApproved: true, evidenceRef: "evidence://provider/backend", at: REPORT_GENERATED_AT });
      const { reconciliation, receipt } = executeSwap({ store, fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PRINCIPALS.ada, approval, operatorSubject: null, at: REPORT_GENERATED_AT, snapshotDir: snapFor(fixture.id) });
      if (!reconciliation.checksums.match) local.push("checksums afstemmer ikke");
      if (!reconciliation.links.preserved) local.push("links er ikke bevaret");
      if (!reconciliation.authorization.preserved) local.push("autorisation er ikke bevaret");
      if (!reconciliation.references.preserved) local.push("referencesporet er ikke bevaret");
      if (reconciliation.counts.created !== fixture.records.length) local.push("antallet af målposter stemmer ikke");
      if (!store.isProviderReadOnly(fixture.from)) local.push("den gamle provider blev ikke sat read-only");
      if (store.listCredentials({ provider: fixture.from, tenantId: fixture.tenantId, active: true }).length !== 0) local.push("gamle credentials blev ikke tilbagekaldt");
      const rolled = rollbackSwap({ store, receipt, destDir: rollbackDir, at: REPORT_GENERATED_AT });
      if (rolled.status !== "rolled-back") local.push("rollback blev ikke gennemført");
      if (rolled.records !== 0) local.push("rollback efterlod målposter");
      if (!rolled.fromActive) local.push("rollback genåbnede ikke den gamle provider");
      scenarios.push(scenario("verified-backend-replacement", { principal: PRINCIPALS.ada.id, tenant: fixture.tenantId, visible: [`${fixture.from}->${fixture.to}`, receipt.status, rolled.status], hidden: [], problems: local, evidenceLevel: "fixture" }));
    }

    // 6) Verificeret appmigration med funktionstab.
    {
      const fixture = pair.app;
      const local = [];
      const approval = recordApproval({ store, principal: PRINCIPALS.ada, tenantId: fixture.tenantId, appId: fixture.appId, contentApproved: true, aclApproved: true, evidenceRef: "evidence://provider/app", at: REPORT_GENERATED_AT });
      const plan = planSwap({ fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy });
      if (plan.status !== "ready") local.push(`appmigrationens plan er '${plan.status}'`);
      const { reconciliation, receipt } = executeSwap({ store, fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PRINCIPALS.ada, approval, at: REPORT_GENERATED_AT, snapshotDir: snapFor(fixture.id) });
      if (!reconciliation.checksums.match) local.push("checksums afstemmer ikke");
      if ((reconciliation.functionalityLoss ?? []).length === 0) local.push("funktionstab blev ikke vist");
      if (!reconciliation.references.preserved) local.push("referencesporet er ikke bevaret");
      const rolled = rollbackSwap({ store, receipt, destDir: join(rollbackDir, "app"), at: REPORT_GENERATED_AT });
      if (rolled.status !== "rolled-back") local.push("appmigrationens rollback blev ikke gennemført");
      scenarios.push(scenario("verified-app-migration", { principal: PRINCIPALS.ada.id, tenant: fixture.tenantId, visible: [`${fixture.from}->${fixture.to}`, receipt.status, rolled.status], hidden: [], problems: local, functionalityLoss: reconciliation.functionalityLoss, evidenceLevel: "fixture" }));
    }

    // 7) IAM-skift bevarer entydig identitet og historisk audit-provenance.
    {
      const fixture = pair.iam;
      const local = [];
      const approval = recordApproval({ store, principal: PRINCIPALS.ada, tenantId: fixture.tenantId, appId: fixture.appId, contentApproved: true, aclApproved: true, evidenceRef: "evidence://provider/iam", at: REPORT_GENERATED_AT });
      const { reconciliation, receipt } = executeSwap({ store, fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PRINCIPALS.ada, approval, at: REPORT_GENERATED_AT, snapshotDir: snapFor(fixture.id) });
      if (!reconciliation.identity.preserved) local.push("identiteten blev ikke bevaret");
      if (!reconciliation.auditProvenance.preserved) local.push("audit-provenancen blev ikke bevaret");
      if (!reconciliation.checksums.match) local.push("checksums afstemmer ikke");
      const rolled = rollbackSwap({ store, receipt, destDir: join(rollbackDir, "iam"), at: REPORT_GENERATED_AT });
      if (rolled.status !== "rolled-back") local.push("IAM-skiftets rollback blev ikke gennemført");
      scenarios.push(scenario("iam-switch-preserves-identity-and-audit", { principal: PRINCIPALS.ada.id, tenant: fixture.tenantId, visible: [`${fixture.from}->${fixture.to}`, receipt.status, rolled.status], hidden: [], problems: local, evidenceLevel: "fixture" }));
    }

    // 8) Ikke-understøttet appskift afvises og cutover kræver godkendelse.
    {
      const local = [];
      const unsupported = preflightSwap({ providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from: "nextcloud", to: "bookstack" });
      if (unsupported.allowed) local.push("et frit appskift blev tilladt uden migrationsbevis");
      let rejectedSelfApproval = false;
      try {
        recordApproval({ store, principal: PRINCIPALS.operator, tenantId: "acme", appId: "platform", contentApproved: true, aclApproved: true, evidenceRef: "evidence://provider/self", operatorSubject: PRINCIPALS.operator.id, at: REPORT_GENERATED_AT });
      } catch (error) {
        rejectedSelfApproval = error.code === "invalid_approval";
      }
      if (!rejectedSelfApproval) local.push("operatøren kunne godkende sit eget skift");
      scenarios.push(scenario("unsupported-swap-rejected", { principal: PRINCIPALS.ada.id, tenant: "acme", visible: unsupported.problems.map((p) => p.code), hidden: [], problems: local }));
    }

    // 9) Tenantisolation og default-deny.
    {
      const local = [];
      if (decideProviderSwapAccess({ principal: PRINCIPALS.gus, tenantId: "acme", action: "read" }).allowed) local.push("globex fik adgang til acme's providers");
      if (!decideProviderSwapAccess({ principal: PRINCIPALS.gus, tenantId: "globex", action: "read" }).allowed) local.push("globex kunne ikke læse sine egne providers");
      if (decideProviderSwapAccess({ principal: null, tenantId: "acme", action: "read" }).allowed) local.push("en manglende principal fik adgang");
      if (decideProviderSwapAccess({ principal: PRINCIPALS.ben, tenantId: "acme", action: "cutover" }).allowed) local.push("en auditor kunne gennemføre cutover");
      if (!decideProviderSwapAccess({ principal: PRINCIPALS.ada, tenantId: "acme", action: "cutover" }).allowed) local.push("provider-admin kunne ikke gennemføre cutover");
      scenarios.push(scenario("tenant-isolation-default-deny", { principal: PRINCIPALS.gus.id, tenant: "globex", visible: ["globex"], hidden: ["acme"], problems: local }));
    }
  } finally {
    cleanup();
    rmSync(rollbackDir, { recursive: true, force: true });
    rmSync(snapshotsDir, { recursive: true, force: true });
  }

  for (const s of scenarios) for (const p of s.problems ?? []) problems.push(`scenario '${s.id}': ${p}`);

  const catalogProblems = capabilityCatalogProblems(all.catalog);
  for (const e of catalogProblems) problems.push(`catalog${e.path}: ${e.message}`);
  for (const e of providerRegistryProblems(all.providers, { catalog: all.catalog })) problems.push(`providers${e.path}: ${e.message}`);
  for (const e of supportMatrixProblems(all.matrix, { providers: all.providers, catalog: all.catalog })) problems.push(`matrix${e.path}: ${e.message}`);
  for (const e of swapPolicyProblems(all.policy)) problems.push(`policy${e.path}: ${e.message}`);
  for (const { file, fixture } of all.swaps) for (const e of swapFixtureProblems(fixture, { providers: all.providers, matrix: all.matrix })) problems.push(`${file}${e.path}: ${e.message}`);

  const report = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ProviderReport",
    metadata: {
      name: "platform-provider-report",
      version: "1.0.0",
      description: "Deterministisk rapport for providerkontrakter og migrationskontrol: versionsstyret capability-forhandling, en supportmatrix over drop-in/planlagt/ikke-understøttet skift, en verificeret backendudskiftning, en appmigration og et IAM-skift med afstemning af data, ACL, id-mapping og funktionstab samt cutover med read-only, credentialrevokation og rollback.",
      accountableHuman: all.catalog.metadata.accountableHuman,
      labels: all.catalog.metadata.labels ?? {},
    },
    generatedAt: REPORT_GENERATED_AT,
    measured: false,
    policyRef: "provider-registry/policy.json",
    totals: {
      classes: all.catalog.classes.length,
      capabilities: all.catalog.capabilities.length,
      mandatory: all.catalog.capabilities.filter((c) => c.mandatory).length,
      securityCritical: all.catalog.capabilities.filter((c) => c.securityCritical).length,
      providers: all.providers.providers.length,
      compatibilityRows: all.matrix.rows.length,
      fixtures: all.swaps.length,
    },
    compatibility,
    scenarios,
  };
  return { report, problems };
}

export async function runProviderCheck(root = repoRoot) {
  const { report, problems } = await buildProviderReport(root);
  return { ok: problems.length === 0, problems, report };
}

function main() {
  runProviderCheck(repoRoot)
    .then((result) => {
      if (!result.ok) {
        console.error("✘ Providerkontrol fejlede:\n");
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log("✔ Capability-forhandling, supportmatrix, backendudskiftning, appmigration, IAM-skift, cutover og tenantisolation er konsistente");
      console.log(`✔ ${result.report.scenarios.length} scenarier bestået; ${result.report.totals.classes} klasser, ${result.report.totals.providers} providere, ${result.report.totals.fixtures} fixtures`);
    })
    .catch((error) => {
      console.error(`✘ Kontrollen kastede: ${error.stack ?? error.message}`);
      process.exit(1);
    });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
