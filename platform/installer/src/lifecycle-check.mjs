/**
 * DKC-061 — fokuseret, deterministisk kontrol af produktlivscyklussen.
 *
 * Kontrollerer offline at:
 *   - releasekataloget er signeret, har supportvindue, EOL-status og vedtaget
 *     håndtering, og at EOL/tilbagekaldte releases ikke kan køres,
 *   - kompatibilitetslåsen resolver, og at en sikkerhedsopdatering peger på en
 *     advisory og en procedure,
 *   - en opdatering har påvirkningsplan, migrationskontrol, rollback og en
 *     menneskelig godkendelse, kan afbrydes, genoptages og rulles tilbage,
 *   - en delt database eller IAM ikke kan fjernes mens aktive moduler kræver
 *     den, at almindelig afinstallering bevarer data og recoverymetadata, og at
 *     datasletning kræver eksport/backup og to-personers-kontrol,
 *   - en supportbundle er redigeret uden hemmeligheder eller ikke-godkendt
 *     HR-indhold og uden skjult fjernadgang, og
 *   - lokale kerneflows består ved et internetudfald, mens eksterne
 *     afhængigheder vises med en eksplicit status.
 *
 * `measured: false`: alt er efterprøvet deterministisk. En rigtig opdatering
 * eller fjernelse på en levende installation kræver ekstern infrastruktur og er
 * NOT RUN.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import {
  loadAll,
  releaseCatalogProblems,
  supportPolicyProblems,
  offlinePackageProblems,
  updatePlanProblems,
  removalPlanProblems,
  verifyReleaseCatalog,
  releaseRunnable,
  REPORT_GENERATED_AT,
} from "./lifecycle-model.mjs";
import { buildUpdatePlan, executeUpdate, resumeUpdate, rollbackUpdate, updateImpact } from "./lifecycle-update.mjs";
import { buildRemovalPlan, executeRemoval } from "./lifecycle-remove.mjs";
import { buildSupportBundle, assertNoHiddenRemoteAccess, SupportBundleError } from "./lifecycle-support.mjs";
import { offlineReadiness } from "./lifecycle-offline.mjs";
import { decideLifecycleAccess } from "./lifecycle-permissions.mjs";
import { FileLifecycleStore } from "./lifecycle-store.mjs";

export { REPORT_GENERATED_AT };

export const PRINCIPALS = {
  ada: { kind: "human", id: "oidc|ada.acme", name: "Ada Acme", tenantId: "acme", roles: ["lifecycle-admin"], clearance: "confidential" },
  ben: { kind: "human", id: "oidc|ben.acme", name: "Ben Acme", tenantId: "acme", roles: ["lifecycle-operator"], clearance: "internal" },
  gus: { kind: "human", id: "oidc|gus.globex", name: "Gus Globex", tenantId: "globex", roles: ["lifecycle-admin"], clearance: "internal" },
  auditor: { kind: "human", id: "oidc|ida.auditor", name: "Ida Auditor", tenantId: "acme", roles: ["lifecycle-auditor"], clearance: "internal" },
};

function loadKeyring(root) {
  return JSON.parse(readFileSync(join(root, "configuration", "dev-keyring.json"), "utf8"));
}

function loadProfile(root, name = "small-vps") {
  return JSON.parse(readFileSync(join(root, "catalog", "profiles", `${name}.profile.json`), "utf8"));
}

function scenario(id, fields) {
  return { id, problems: [], ...fields };
}

export async function buildLifecycleReport(root = repoRoot) {
  const all = loadAll(root);
  const keyring = loadKeyring(root);
  const profile = loadProfile(root);
  const problems = [];
  const scenarios = [];

  // 1) Releasekatalog: signeret, supportvindue, EOL/revoked med håndtering.
  {
    const local = [];
    const verified = verifyReleaseCatalog(all.catalog, keyring);
    if (!verified.ok) local.push(...verified.problems);
    for (const release of all.catalog.releases) {
      if ((release.channel === "eol" || release.channel === "revoked") && !release.handling) local.push(`release '${release.id}' mangler vedtaget håndtering`);
    }
    for (const release of all.catalog.releases) {
      if (release.channel === "revoked" && releaseRunnable(release)) local.push(`den tilbagekaldte release '${release.id}' blev anset for kørbar`);
    }
    scenarios.push(scenario("release-catalog-signed-and-lifecycle-visible", {
      principal: "platform:release",
      visible: all.catalog.releases.map((r) => `${r.id}:${r.channel}`),
      hidden: [],
      problems: local,
      signed: verified.ok,
      eolHandling: all.catalog.releases.filter((r) => r.channel === "eol" || r.channel === "revoked").length,
    }));
  }

  // 2) Kompatibilitetslås, supportvindue og sikkerhedsopdatering.
  {
    const local = [];
    const stable = all.catalog.releases.find((r) => r.id === "1.4.0");
    const security = all.catalog.releases.find((r) => r.channel === "security");
    if (!stable) local.push("den stabile release 1.4.0 mangler");
    if (!(Object.keys(stable?.compatibilityLock ?? {}).length >= 3)) local.push("kompatibilitetslåsen er for tynd");
    if (!security?.securityUpdates?.length) local.push("sikkerhedskanalen mangler en sikkerhedsopdatering");
    for (const update of security?.securityUpdates ?? []) {
      if (!update.advisoryId || !update.procedure) local.push(`sikkerhedsopdateringen '${update.advisoryId}' mangler advisory eller procedure`);
      if (!all.catalog.releases.some((r) => r.id === update.fixedIn)) local.push(`sikkerhedsopdateringen peger på den ukendte release '${update.fixedIn}'`);
    }
    scenarios.push(scenario("compatibility-lock-support-window-security-update", {
      principal: "platform:release",
      visible: [`stable=${stable?.id}`, `security=${security?.id}`, `lock=${Object.keys(stable?.compatibilityLock ?? {}).length}`],
      hidden: [],
      problems: local,
    }));
  }

  // 3) Opdatering: påvirkning, migrationskontrol, godkendelse, afbrydelse, genoptagelse og rollback.
  const workRoot = mkdtempSync(join(tmpdir(), "dkc061-check-"));
  const store = FileLifecycleStore.open(join(workRoot, "store"));
  store.setActiveRelease("1.3.0", { at: REPORT_GENERATED_AT });
  store.setComponents(Object.fromEntries(Object.entries(all.catalog.releases.find((r) => r.id === "1.3.0").compatibilityLock)), { at: REPORT_GENERATED_AT });
  const snapshotDir = join(workRoot, "snapshot");
  try {
    const approval = { humanSubject: PRINCIPALS.ada.id, approvalRef: "approval://lifecycle/update/1", twoPerson: true };
    const plan = buildUpdatePlan({
      installationId: "acme-prod",
      fromRelease: "1.3.0",
      toRelease: "1.4.0",
      catalog: all.catalog,
      components: all.components,
      profile,
      keyring,
      approval,
      now: REPORT_GENERATED_AT,
    });
    const impact = updateImpact({ fromRelease: all.catalog.releases.find((r) => r.id === "1.3.0"), toRelease: all.catalog.releases.find((r) => r.id === "1.4.0"), components: all.components });
    const local = [];
    for (const p of updatePlanProblems(plan, { now: Date.parse(REPORT_GENERATED_AT) })) local.push(`${p.path}: ${p.message}`);
    if (plan.preflight.ok !== true) local.push(`preflight fejlede: ${plan.preflight.blockingProblems.join("; ")}`);
    if (impact.upgraded.length === 0) local.push("påvirkningsplanen viser ingen opgraderinger");
    if (plan.migrationCheck.phases.length === 0) local.push("migrationskontrollen viser ingen faser");

    // Afvis et muterende trin uden godkendelse.
    const stepIds = plan.steps.filter((s) => s.mutating).map((s) => s.id);
    const denied = await executeUpdate({ plan, store, keyring, executors: { run: async () => ({ ok: true }) }, authorization: null, snapshotDir, targetComponents: all.catalog.releases.find((r) => r.id === "1.4.0").compatibilityLock, at: REPORT_GENERATED_AT });
    if (denied.ok !== false || denied.code !== "APPROVAL_REQUIRED") local.push("en muterende opdatering uden godkendelse blev ikke afvist");

    // Afbryd ved migrationssteppet, og genoptag.
    let failOn = "migrate-schema";
    const executors = { run: async (step) => { if (step.id === failOn) throw new Error("simuleret afbrydelse"); return { ok: true, step: step.id }; } };
    const interrupted = await executeUpdate({ plan, store, keyring, executors, authorization: { humanSubject: PRINCIPALS.ada.id, stepIds }, snapshotDir, targetComponents: all.catalog.releases.find((r) => r.id === "1.4.0").compatibilityLock, at: REPORT_GENERATED_AT });
    if (interrupted.ok !== false) local.push("den simulerede afbrydelse blev ikke registreret");
    failOn = null;
    const resumed = await resumeUpdate({ plan, store, keyring, executors, authorization: { humanSubject: PRINCIPALS.ada.id, stepIds }, targetComponents: all.catalog.releases.find((r) => r.id === "1.4.0").compatibilityLock, at: REPORT_GENERATED_AT });
    if (resumed.ok !== true) local.push(`genoptagelsen fejlede: ${resumed.error}`);
    if (store.getActiveRelease() !== "1.4.0") local.push("den aktive release blev ikke opdateret");

    // Rul tilbage til snapshot-tilstanden.
    const rolled = rollbackUpdate({ store, updateId: plan.metadata.name, destDir: join(workRoot, "restored"), at: REPORT_GENERATED_AT });
    if (rolled.status !== "rolled-back") local.push("rollback blev ikke gennemført");
    if (rolled.restoredRelease !== "1.3.0") local.push("rollback gendannede ikke den forrige release");
    if (!store.getComponents()["platform-core"]) local.push("komponenterne forsvandt");

    scenarios.push(scenario("update-impact-migration-approval-resume-rollback", {
      principal: PRINCIPALS.ada.id,
      tenant: "acme",
      visible: [`impact+${impact.upgraded.length}`, `steps=${plan.steps.length}`, rolled.status],
      hidden: [],
      problems: local,
      planDigest: plan.catalogDigest,
      evidenceLevel: "fixture",
    }));
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }

  // 4) Delt database/IAM afvises mens aktive moduler kræver den.
  {
    const local = [];
    const installed = { communications: "2.1.0", hr: "1.4.0", bi: "3.0.0" };
    const dbPlan = buildRemovalPlan({ installationId: "acme-prod", removeId: "primary-database", mode: "remove-only", components: all.components, profile, installed, now: REPORT_GENERATED_AT });
    if (!dbPlan.blocking) local.push("fjernelse af den delte primary-database blev ikke blokeret");
    if (!dbPlan.preflight.blockingProblems.some((p) => p.includes("delt afhængighed"))) local.push("den delte afhængighed blev ikke rapporteret");
    const dbRun = await executeRemoval({ plan: dbPlan, store, executors: { run: async () => ({ ok: true }) }, at: REPORT_GENERATED_AT });
    if (dbRun.ok !== false || dbRun.code !== "SHARED_DEPENDENCY") local.push("fjernelsen af den delte database blev ikke afvist ved eksekvering");

    const iamPlan = buildRemovalPlan({ installationId: "acme-prod", removeId: "identity-broker", mode: "remove-only", components: all.components, profile, installed, now: REPORT_GENERATED_AT });
    if (!iamPlan.blocking) local.push("fjernelse af IAM blev ikke blokeret");
    if (!iamPlan.preflight.blockingProblems.some((p) => p.includes("sikkerhedskernen"))) local.push("sikkerhedskernen blev ikke beskyttet");

    scenarios.push(scenario("shared-database-and-iam-removal-rejected", {
      principal: PRINCIPALS.ada.id,
      tenant: "acme",
      visible: [`dbBlocking=${dbPlan.blocking}`, `iamBlocking=${iamPlan.blocking}`],
      hidden: [],
      problems: local,
    }));
  }

  // 5) Almindelig afinstallering bevarer data og recoverymetadata.
  {
    const local = [];
    const plan = buildRemovalPlan({ installationId: "acme-prod", removeId: "communications", mode: "remove-only", components: all.components, profile, installed: {}, now: REPORT_GENERATED_AT });
    for (const p of removalPlanProblems(plan, { now: Date.parse(REPORT_GENERATED_AT) })) local.push(`${p.path}: ${p.message}`);
    if (plan.blocking) local.push("en almindelig afinstallering af en ikke-delt applikation blev blokeret");
    if (plan.dataDisposition.preserve !== true) local.push("almindelig afinstallering bevarede ikke data");
    if (!plan.dataDisposition.recoveryMetadataRef) local.push("recoverymetadata blev ikke bevaret");
    if (plan.dataDisposition.destructiveApproved === true) local.push("almindelig afinstallering blev markeret destruktiv");
    const run = await executeRemoval({ plan, store, executors: { run: async () => ({ ok: true }) }, at: REPORT_GENERATED_AT });
    if (run.ok !== true) local.push(`afinstalleringen fejlede: ${run.error}`);
    scenarios.push(scenario("uninstall-preserves-data-and-recovery-metadata", {
      principal: PRINCIPALS.ada.id,
      tenant: "acme",
      visible: ["preserve=true", plan.dataDisposition.recoveryMetadataRef],
      hidden: [],
      problems: local,
    }));
  }

  // 6) Datasletning kræver eksport/backup og to-personers-kontrol.
  {
    const local = [];
    const noEvidence = buildRemovalPlan({ installationId: "acme-prod", removeId: "communications", mode: "remove-and-delete-data", components: all.components, profile, installed: {}, approval: { humanSubject: PRINCIPALS.ada.id, secondHumanSubject: PRINCIPALS.ben.id, approvalRef: "approval://lifecycle/delete/1", destructiveApproved: true }, now: REPORT_GENERATED_AT });
    if (noEvidence.preflight.ok !== false) local.push("datasletning uden eksport/backup blev ikke blokeret");
    const runNoEvidence = await executeRemoval({ plan: noEvidence, store, executors: { run: async () => ({ ok: true }) }, authorization: { humanSubject: PRINCIPALS.ada.id, secondHumanSubject: PRINCIPALS.ben.id }, at: REPORT_GENERATED_AT });
    if (runNoEvidence.code !== "NO_EXPORT_OR_BACKUP") local.push("datasletning uden bevis blev ikke afvist");

    const plan = buildRemovalPlan({
      installationId: "acme-prod",
      removeId: "communications",
      mode: "remove-and-delete-data",
      components: all.components,
      profile,
      installed: {},
      exportRef: "export://acme/communications",
      backupRef: "backup://acme/communications",
      approval: { humanSubject: PRINCIPALS.ada.id, secondHumanSubject: PRINCIPALS.ben.id, approvalRef: "approval://lifecycle/delete/2", destructiveApproved: true },
      now: REPORT_GENERATED_AT,
    });
    for (const p of removalPlanProblems(plan, { now: Date.parse(REPORT_GENERATED_AT) })) local.push(`${p.path}: ${p.message}`);
    const onePerson = await executeRemoval({ plan, store, executors: { run: async () => ({ ok: true }) }, authorization: { humanSubject: PRINCIPALS.ada.id, secondHumanSubject: PRINCIPALS.ada.id }, at: REPORT_GENERATED_AT });
    if (onePerson.code !== "TWO_PERSON_REQUIRED") local.push("datasletning med samme person blev ikke afvist");
    const run = await executeRemoval({ plan, store, executors: { run: async () => ({ ok: true }) }, authorization: { humanSubject: PRINCIPALS.ada.id, secondHumanSubject: PRINCIPALS.ben.id }, at: REPORT_GENERATED_AT });
    if (run.ok !== true) local.push(`den godkendte datasletning fejlede: ${run.error}`);
    scenarios.push(scenario("destructive-delete-requires-evidence-and-two-person", {
      principal: PRINCIPALS.ada.id,
      tenant: "acme",
      visible: ["export+backup", PRINCIPALS.ben.id],
      hidden: [],
      problems: local,
    }));
  }

  // 7) Supportbundle uden hemmeligheder eller HR-indhold og uden skjult fjernadgang.
  {
    const local = [];
    const bundle = buildSupportBundle({
      policy: all.support,
      installationId: "acme-prod",
      sources: {
        "installer-status": { status: "done", steps: 8, apiKey: "should-be-redacted" },
        "release-version": { release: "1.4.0", channel: "stable" },
        "component-versions": { "platform-core": "1.4.0", "identity-broker": "1.2.0" },
        "preflight-checks": { ok: true, checks: 24 },
      },
      at: REPORT_GENERATED_AT,
    });
    if (bundle.redacted !== true) local.push("bundlen er ikke redigeret");
    if (bundle.content["installer-status"].apiKey !== "[REDACTED]") local.push("en hemmelighed blev ikke redigeret");
    assertNoHiddenRemoteAccess(bundle);
    if (bundle.remoteAccess.enabled !== false || bundle.remoteAccess.hiddenAccess !== false) local.push("fjernadgang er ikke slået fra som standard");

    let blockedSecret = false;
    try {
      buildSupportBundle({ policy: all.support, installationId: "acme-prod", sources: { "installer-status": { note: "sk-abcdefghijklmnopqrstuvwxyz" } }, at: REPORT_GENERATED_AT });
    } catch (error) {
      blockedSecret = error instanceof SupportBundleError && error.code === "SECRET_LEAK";
    }
    if (!blockedSecret) local.push("en rå hemmelighedssignatur blev ikke blokeret");

    let blockedHr = false;
    try {
      buildSupportBundle({ policy: all.support, installationId: "acme-prod", sources: { "component-versions": { salary: 42000 } }, at: REPORT_GENERATED_AT });
    } catch (error) {
      blockedHr = error instanceof SupportBundleError && error.code === "HR_LEAK";
    }
    if (!blockedHr) local.push("ikke-godkendt HR-indhold blev ikke blokeret");

    let blockedRemote = false;
    try {
      buildSupportBundle({ policy: all.support, installationId: "acme-prod", sources: {}, remoteAccess: { enabled: true }, at: REPORT_GENERATED_AT });
    } catch (error) {
      blockedRemote = error instanceof SupportBundleError && error.code === "CONSENT_REQUIRED";
    }
    if (!blockedRemote) local.push("fjernadgang uden samtykke blev ikke blokeret");

    scenarios.push(scenario("support-bundle-redacted-no-secrets-no-hr-no-hidden-access", {
      principal: "platform:support",
      visible: bundle.collected.map((c) => c.id),
      hidden: ["secret", "hr-personal"],
      problems: local,
    }));
  }

  // 8) Offline: lokale kerneflows består; eksterne afhængigheder vises.
  {
    const local = [];
    const readiness = offlineReadiness(all.offline, { online: false });
    if (!readiness.coreFlowsRemainLocal) local.push("de lokale kerneflows består ikke offline");
    if (readiness.localFlows.length === 0) local.push("der er ingen lokale kerneflows");
    if (!readiness.noSilentFallback) local.push("der findes en tavs fallback");
    if (readiness.problems.length) local.push(...readiness.problems);
    const unavailable = readiness.external.filter((e) => !e.available);
    if (unavailable.length === 0) local.push("ingen ekstern afhængighed blev markeret utilgængelig");
    if (unavailable.some((e) => !e.message?.trim())) local.push("en utilgængelig ekstern funktion blev ikke vist tydeligt");
    for (const route of all.routes) {
      if (!all.offline.externalDependencies.some((d) => (d.routeRefs ?? []).includes(route.id))) local.push(`gateway-ruten '${route.id}' er ikke markeret`);
    }
    scenarios.push(scenario("offline-local-core-flows-preserved-external-visible", {
      principal: "platform:operations",
      visible: readiness.localFlows,
      hidden: [],
      problems: local,
      externalUnavailable: unavailable.map((e) => e.id),
    }));
  }

  // 9) Default-deny og tenantisolation.
  {
    const local = [];
    if (decideLifecycleAccess({ principal: PRINCIPALS.gus, tenantId: "acme", action: "read" }).allowed) local.push("globex fik adgang til acme");
    if (!decideLifecycleAccess({ principal: PRINCIPALS.gus, tenantId: "globex", action: "read" }).allowed) local.push("globex kunne ikke læse egne data");
    if (decideLifecycleAccess({ principal: null, tenantId: "acme", action: "read" }).allowed) local.push("en manglende principal fik adgang");
    if (decideLifecycleAccess({ principal: PRINCIPALS.auditor, tenantId: "acme", action: "update" }).allowed) local.push("en auditor kunne opdatere");
    if (!decideLifecycleAccess({ principal: PRINCIPALS.ben, tenantId: "acme", action: "update" }).allowed) local.push("en operator kunne ikke opdatere");
    if (decideLifecycleAccess({ principal: PRINCIPALS.ben, tenantId: "acme", action: "delete-data", consent: { secondHumanSubject: PRINCIPALS.ben.id } }).allowed) local.push("datasletning med samme person blev tilladt");
    if (!decideLifecycleAccess({ principal: PRINCIPALS.ada, tenantId: "acme", action: "delete-data", consent: { secondHumanSubject: PRINCIPALS.ben.id } }).allowed) local.push("datasletning med to personer blev afvist");
    if (decideLifecycleAccess({ principal: PRINCIPALS.ada, tenantId: "acme", action: "remote-access", consent: { enabled: false } }).allowed) local.push("fjernadgang uden aktivering blev tilladt");
    scenarios.push(scenario("default-deny-and-tenant-isolation", {
      principal: PRINCIPALS.gus.id,
      tenant: "globex",
      visible: ["globex"],
      hidden: ["acme"],
      problems: local,
    }));
  }

  // Saml datafilernes semantik.
  for (const e of releaseCatalogProblems(all.catalog, { keyring, components: all.components, now: Date.parse(REPORT_GENERATED_AT) })) problems.push(`catalog/releases.json${e.path}: ${e.message}`);
  for (const e of supportPolicyProblems(all.support)) problems.push(`support/policy.json${e.path}: ${e.message}`);
  for (const e of offlinePackageProblems(all.offline, { components: all.components, routes: all.routes })) problems.push(`catalog/offline-package.json${e.path}: ${e.message}`);
  for (const s of scenarios) for (const p of s.problems ?? []) problems.push(`scenario '${s.id}': ${p}`);

  const report = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "LifecycleReport",
    metadata: {
      name: "platform-lifecycle-report",
      version: "1.0.0",
      description: "Deterministisk rapport for produktlivscyklussen: signeret releasekatalog med supportvindue, EOL-status og kompatibilitetslås, modulopdatering med påvirkning/migrationskontrol/rollback/godkendelse, fjernelse adskilt fra datasletning med reverse-dependency-kontrol, redigerede supportbundles uden skjult fjernadgang og offlinepakke med lokale kerneflows.",
      accountableHuman: all.catalog.metadata.accountableHuman,
      labels: all.catalog.metadata.labels ?? {},
    },
    generatedAt: REPORT_GENERATED_AT,
    measured: false,
    policyRef: "support/policy.json",
    totals: {
      releases: all.catalog.releases.length,
      stableReleases: all.catalog.releases.filter((r) => r.channel === "stable").length,
      lockedComponents: Object.keys(all.catalog.releases.find((r) => r.channel === "stable")?.compatibilityLock ?? {}).length,
      supportAllowlist: all.support.allowlist.length,
      externalDependencies: all.offline.externalDependencies.length,
      coreFlows: all.offline.coreFlows.length,
    },
    scenarios,
  };
  return { report, problems };
}

export async function runLifecycleCheck(root = repoRoot) {
  const { report, problems } = await buildLifecycleReport(root);
  return { ok: problems.length === 0, problems, report };
}

async function main() {
  const result = await runLifecycleCheck(repoRoot);
  if (!result.ok) {
    console.error("✘ Livscykluskontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("✔ Releasekatalog, opdatering, fjernelse, supportbundle og offlinepakke er konsistente");
  console.log(`✔ ${result.report.scenarios.length} scenarier bestået; ${result.report.totals.releases} releases, ${result.report.totals.lockedComponents} låste komponenter, ${result.report.totals.coreFlows} kerneflows`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
