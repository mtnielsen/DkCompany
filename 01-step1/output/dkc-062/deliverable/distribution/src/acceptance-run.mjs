/**
 * DKC-062 — kørebare acceptscenarier.
 *
 * Hver brugerrejse eksekveres deterministisk mod den faktiske installer-,
 * livscyklus-, provider- og migrationstak. Der muteres kun i midlertidige
 * arbejdstræer, og hvert trins faktiske udfald sammenlignes med det forventede.
 * En grøn fixture-kørsel er ikke en menneskelig accept og heller ikke en målt
 * drift på en levende VPS/lokal/HA-installation.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents, loadProfiles, loadPlatforms, loadDeploymentProfiles } from "./catalog.mjs";
import { findDeploymentProfile } from "./profiles.mjs";
import { resolveDependencies } from "./resolver.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";
import { runPreflight } from "../../installer/src/preflight.mjs";
import { buildInstallerPlan, signPlan } from "../../installer/src/plan.mjs";
import { createInstallStateStore } from "../../installer/src/state.mjs";
import { createStepExecutors, runInstaller } from "../../installer/src/run.mjs";
import { buildRemovalPlan, executeRemoval } from "../../installer/src/lifecycle-remove.mjs";
import { buildUpdatePlan, executeUpdate, resumeUpdate, rollbackUpdate } from "../../installer/src/lifecycle-update.mjs";
import { FileLifecycleStore } from "../../installer/src/lifecycle-store.mjs";
import { REPORT_GENERATED_AT } from "./acceptance-model.mjs";
import { configurationDigest } from "../../configuration/src/model.mjs";
import { planConfigurationChange } from "../../configuration/src/desired-state.mjs";
import { createAgentRegistry } from "../../agent-registry/src/registry.mjs";
import { validateRoleManifest } from "../../agent-registry/src/roles.mjs";
import { assertIndependentVerification } from "../../agent-registry/src/handoff.mjs";
import { createScheduler } from "../../agent-registry/src/scheduler.mjs";
import { loadAll as loadProviderAll, loadSwapFixtures } from "../../migration/src/provider-model.mjs";
import { preflightSwap } from "../../migration/src/provider-negotiate.mjs";
import { executeSwap, rollbackSwap } from "../../migration/src/provider-swap.mjs";
import { FileProviderStore } from "../../migration/src/provider-store.mjs";
import { recordApproval } from "../../migration/src/approval.mjs";
import { setupMigration } from "../../migration/src/check.mjs";
import { importBatch } from "../../migration/src/import.mjs";
import { buildExport, writeExport } from "../../migration/src/export.mjs";

const HUMAN = { kind: "human", id: "oidc|anna.andersen", name: "Anna Andersen", roles: ["platform-admin"] };
const PROVIDER_HUMAN = { kind: "human", id: "oidc|ada.install", name: "Ada Install", tenantId: "acme", roles: ["provider-admin"], clearance: "confidential" };

const loadCatalogComponents = (root) => loadComponents(join(root, "catalog", "components"));
const loadCatalogProfiles = (root) => loadProfiles(join(root, "catalog", "profiles"));
const loadPlatformList = (root) => loadPlatforms(join(root, "catalog", "platforms.json")).platforms;
const loadDeploymentProfileExamples = (root) => loadDeploymentProfiles(join(root, "contracts", "examples"));

function stepResult(id, status, detail = null) {
  return { id, status, detail };
}

function expectedSteps(scenario) {
  return new Map((scenario.steps ?? []).map((s) => [s.id, s.expected]));
}

function outcomeFor(scenario, steps, problems, extra = {}) {
  const expected = expectedSteps(scenario);
  const mismatches = [];
  for (const step of steps) {
    const want = expected.get(step.id);
    if (want && want !== step.status) mismatches.push(`trinnet '${step.id}' gav '${step.status}', forventet '${want}'`);
  }
  for (const id of expected.keys()) {
    if (!steps.some((s) => s.id === id)) mismatches.push(`trinnet '${id}' blev ikke kørt`);
  }
  const allProblems = [...(problems ?? []), ...mismatches];
  return {
    id: scenario.id,
    journey: scenario.journey,
    profileRef: scenario.profileRef,
    platformRef: scenario.platformRef,
    target: scenario.target,
    status: allProblems.length === 0 ? "passed" : "failed",
    steps,
    problems: allProblems,
    ...extra,
  };
}

function manifestFor({ role, name, spiffeId }) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentManifest",
    metadata: { name, version: "1.0.0", description: `acceptance-probe ${role}` },
    role,
    identity: { spiffeId },
    model: { provider: "local", model: "deterministic" },
    capabilities: [],
  };
}

/** Bevis at ingen agent kan udføre to roller via rotation, alias eller subagent. */
export function probeRoleSeparation() {
  const violations = [];

  const multi = validateRoleManifest({ role: "planner", roles: ["planner", "executor"] });
  if (multi.ok) violations.push("multi-role-manifest");

  const registry = createAgentRegistry({ clock: () => Date.parse(REPORT_GENERATED_AT) });
  const rotId = "spiffe://platform.example.org/agents/accept-rot";
  registry.register({ principal: HUMAN, manifest: manifestFor({ role: "planner", name: "accept-rot", spiffeId: rotId }) });
  try {
    registry.register({ principal: HUMAN, manifest: manifestFor({ role: "executor", name: "accept-rot", spiffeId: rotId }) });
    violations.push("role-rotation");
  } catch (error) {
    if (error.code !== "role_immutable") violations.push("role-rotation");
  }
  try {
    registry.reprovision({ principal: HUMAN, spiffeId: rotId, manifest: manifestFor({ role: "executor", name: "accept-rot", spiffeId: rotId }) });
    violations.push("role-rotation");
  } catch (error) {
    if (error.code !== "identity_reuse") violations.push("role-rotation");
  }

  const aliasRegistry = createAgentRegistry({ clock: () => Date.parse(REPORT_GENERATED_AT) });
  aliasRegistry.register({ principal: HUMAN, manifest: manifestFor({ role: "planner", name: "accept-alias", spiffeId: "spiffe://platform.example.org/agents/alias-1" }) });
  try {
    aliasRegistry.register({ principal: HUMAN, manifest: manifestFor({ role: "planner", name: "accept-alias", spiffeId: "spiffe://platform.example.org/agents/alias-2" }) });
    violations.push("alias");
  } catch (error) {
    if (error.code !== "alias_reuse") violations.push("alias");
  }

  try {
    assertIndependentVerification({ producer: { spiffeId: "a", role: "implementer", modelRef: "local/deterministic" }, verifier: { spiffeId: "a", role: "implementer", modelRef: "local/deterministic" } });
    violations.push("subagent");
  } catch {
    // forventet afvisning
  }

  try {
    createScheduler({ registry }).allCredentials();
    violations.push("shared-credential");
  } catch {
    // forventet afvisning
  }

  return violations;
}

function buildInstallHarness({ scenario, keyring, config, hostScopeBase, platforms, root }) {
  const components = loadCatalogComponents(root);
  const profiles = loadCatalogProfiles(root);
  const deploymentProfiles = loadDeploymentProfileExamples(root);
  const serviceClasses = loadServiceClasses();
  const profile = profiles.find((p) => p.data?.metadata?.name === scenario.profileRef)?.data;
  if (!profile) throw new Error(`profilen '${scenario.profileRef}' findes ikke`);
  const deploymentProfile = findDeploymentProfile(deploymentProfiles, profile.deploymentProfileRef);
  const preview = resolveDependencies({ components, profile, selection: scenario.selection ?? [], deploymentProfile, serviceClasses });
  const hostScope = { ...hostScopeBase, os: { ...hostScopeBase.os, supportedMatrixRef: scenario.platformRef } };
  const configDigest = configurationDigest(config);
  const preflight = runPreflight({ hostScope, platformMatrix: platforms, config, configDigest, disks: [], existingDatabase: null });
  const plan = buildInstallerPlan({
    installationId: config.metadata.installationId,
    profile,
    platformId: scenario.platformRef,
    hostScope,
    configDigest,
    preview,
    preflight,
    components: components.map((c) => c.data),
    now: REPORT_GENERATED_AT,
  });
  const signed = signPlan(plan, { keyId: keyring.keys[0].keyId, secret: keyring.keys[0].secret, signedAt: REPORT_GENERATED_AT });
  return { components, preview, preflight, plan: signed, configDigest };
}

async function executePlan({ plan, statePath, keyring, authorization, failOn = null }) {
  const store = createInstallStateStore({ path: statePath, clock: () => Date.parse(REPORT_GENERATED_AT) });
  const handlers = {};
  for (const step of plan.steps) handlers[step.id] = async (s) => ({ ok: true, step: s.id });
  if (failOn) handlers[failOn] = async () => { throw new Error("simuleret afbrydelse"); };
  const result = await runInstaller({ plan, store, executors: createStepExecutors(handlers), keyring, authorization, clock: () => Date.parse(REPORT_GENERATED_AT) });
  return { result, store };
}

function mutatingStepIds(plan) {
  return plan.steps.filter((s) => s.mutating).map((s) => s.id);
}

async function runInstallScenario(scenario, { keyring, config, hostScopeBase, platforms, root }) {
  const steps = [];
  const problems = [];
  const work = mkdtempSync(join(tmpdir(), "dkc062-install-"));
  try {
    const harness = buildInstallHarness({ scenario, keyring, config, hostScopeBase, platforms, root });
    if (harness.preflight.ok !== true) problems.push(`preflight fejlede: ${harness.preflight.blockingProblems.join("; ")}`);
    steps.push(stepResult("preflight", harness.preflight.ok ? "ok" : "blocked"));
    steps.push(stepResult("plan", "ok", `digest=${harness.plan.signature?.value?.slice(0, 12)}`));

    const authorization = { humanSubject: HUMAN.id, stepIds: mutatingStepIds(harness.plan) };
    const statePath = join(work, "state.json");

    if (scenario.steps.some((s) => s.expected === "resumable")) {
      const first = await executePlan({ plan: harness.plan, statePath, keyring, authorization, failOn: "configure" });
      steps.push(stepResult("install", first.result.ok === false ? "resumable" : "ok"));
      const resumed = await executePlan({ plan: harness.plan, statePath, keyring, authorization });
      steps.push(stepResult("resume", resumed.result.ok ? "ok" : "blocked"));
      if (!resumed.result.ok) problems.push(`genoptagelsen fejlede: ${resumed.result.error}`);
    } else if (scenario.steps.some((s) => s.action === "escalate")) {
      const denied = await executePlan({ plan: harness.plan, statePath, keyring, authorization: null });
      const approvalRequired = denied.result.ok === false && denied.result.code === "APPROVAL_REQUIRED";
      steps.push(stepResult("escalate", approvalRequired ? "approval-required" : "ok"));
      if (!approvalRequired) problems.push("en muterende installation uden godkendelse blev ikke afvist");
      const rerun = await executePlan({ plan: harness.plan, statePath: join(work, "state-approved.json"), keyring, authorization });
      steps.push(stepResult("install", rerun.result.ok ? "ok" : "blocked"));
      if (!rerun.result.ok) problems.push(`den godkendte installation fejlede: ${rerun.result.error}`);
    } else {
      const run = await executePlan({ plan: harness.plan, statePath, keyring, authorization });
      const action = scenario.steps.find((s) => ["install", "add"].includes(s.action))?.action ?? "install";
      steps.push(stepResult(action, run.result.ok ? "ok" : "blocked"));
      if (!run.result.ok) problems.push(`installationen fejlede: ${run.result.error}`);
    }

    const preview = harness.preview;
    if (!preview.ok) problems.push(`dependency-resolveren fejlede: ${preview.errors.map((e) => e.code).join(", ")}`);
    for (const app of scenario.selection ?? []) {
      if (!preview.closure?.includes(app)) problems.push(`den valgte applikation '${app}' er ikke i closure`);
    }
    if (scenario.ha === true && !preview.closure?.includes("platform-core")) problems.push("sikkerhedskernen mangler i HA-closure");
    steps.push(stepResult("verify", problems.length === 0 ? "ok" : "blocked"));
    return outcomeFor(scenario, steps, problems, { selection: scenario.selection ?? [], closure: preview.closure ?? [] });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function runConfigureScenario(scenario, { keyring, config, hostScopeBase, platforms, root }) {
  const steps = [];
  const problems = [];
  const work = mkdtempSync(join(tmpdir(), "dkc062-configure-"));
  try {
    const desired = JSON.parse(JSON.stringify(config));
    desired.installation = { ...desired.installation, logLevel: "warn" };
    const change = planConfigurationChange({ current: config, desired });
    if (change.changes.length === 0) problems.push("konfigurationsændringen gav ingen diff");
    if (change.requiresHumanApproval !== true) problems.push("konfigurationsændringen krævede ikke menneskelig godkendelse");
    steps.push(stepResult("plan", "ok", `${change.changes.length} ændring(er)`));

    const harness = buildInstallHarness({ scenario, keyring, config, hostScopeBase, platforms, root });
    const authorization = { humanSubject: HUMAN.id, stepIds: mutatingStepIds(harness.plan) };
    const run = await executePlan({ plan: harness.plan, statePath: join(work, "state.json"), keyring, authorization });
    steps.push(stepResult("configure", run.result.ok ? "ok" : "blocked"));
    if (!run.result.ok) problems.push(`konfigurationen fejlede: ${run.result.error}`);
    steps.push(stepResult("verify", problems.length === 0 ? "ok" : "blocked"));
    return outcomeFor(scenario, steps, problems, { changes: change.changes.map((c) => c.path) });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function runRemoveScenario(scenario, { keyring, config, hostScopeBase, platforms, root }) {
  const steps = [];
  const problems = [];
  const work = mkdtempSync(join(tmpdir(), "dkc062-remove-"));
  try {
    const components = loadCatalogComponents(root).map((c) => c.data);
    const profile = loadCatalogProfiles(root).find((p) => p.data?.metadata?.name === scenario.profileRef)?.data;
    const deploymentProfiles = loadDeploymentProfileExamples(root);
    const serviceClasses = loadServiceClasses();
    const deploymentProfile = findDeploymentProfile(deploymentProfiles, profile.deploymentProfileRef);
    const removeId = scenario.selection?.[0] ?? "hr";
    const installed = { hr: "1.4.0" };
    const plan = buildRemovalPlan({ installationId: config.metadata.installationId, removeId, mode: "remove-only", components, profile, installed, deploymentProfile, serviceClasses, now: REPORT_GENERATED_AT });
    if (plan.blocking) problems.push(`fjernelsen blev blokeret: ${plan.preflight.blockingProblems.join("; ")}`);
    if (plan.dataDisposition.preserve !== true) problems.push("fjernelsen bevarede ikke data");
    const store = FileLifecycleStore.open(join(work, "store"));
    const run = await executeRemoval({ plan, store, executors: { run: async () => ({ ok: true }) }, authorization: { humanSubject: HUMAN.id }, at: REPORT_GENERATED_AT });
    if (!run.ok) problems.push(`afinstalleringen fejlede: ${run.error}`);
    steps.push(stepResult("remove", run.ok ? "ok" : "blocked"));
    steps.push(stepResult("verify", problems.length === 0 ? "ok" : "blocked"));
    return outcomeFor(scenario, steps, problems, { preserve: plan.dataDisposition.preserve, recoveryMetadataRef: plan.dataDisposition.recoveryMetadataRef });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function runUpgradeScenario(scenario, { keyring, config, root }, { recovery = false } = {}) {
  const steps = [];
  const problems = [];
  const work = mkdtempSync(join(tmpdir(), "dkc062-upgrade-"));
  try {
    const catalog = JSON.parse(readFileSync(join(repoRoot, "catalog", "releases.json"), "utf8"));
    const components = loadCatalogComponents(root).map((c) => c.data);
    const profile = loadCatalogProfiles(root).find((p) => p.data?.metadata?.name === scenario.profileRef)?.data;
    const store = FileLifecycleStore.open(join(work, "store"));
    const from = "1.3.0";
    const to = "1.4.0";
    const lock = catalog.releases.find((r) => r.id === from).compatibilityLock;
    store.setActiveRelease(from, { at: REPORT_GENERATED_AT });
    store.setComponents(Object.fromEntries(Object.entries(lock)), { at: REPORT_GENERATED_AT });
    const plan = buildUpdatePlan({ installationId: config.metadata.installationId, fromRelease: from, toRelease: to, catalog, components, profile, keyring, approval: { humanSubject: HUMAN.id, approvalRef: "approval://acceptance/upgrade", twoPerson: true }, now: REPORT_GENERATED_AT });
    if (!plan.preflight.ok) problems.push(`opdaterings-preflight fejlede: ${plan.preflight.blockingProblems.join("; ")}`);
    steps.push(stepResult("plan", "ok", `impact=${plan.impact.upgraded.length}`));

    const stepIds = plan.steps.filter((s) => s.mutating).map((s) => s.id);
    const targetComponents = catalog.releases.find((r) => r.id === to).compatibilityLock;
    const snapshotDir = join(work, "snapshot");
    let failOn = recovery ? "configure" : null;
    const executors = { run: async (step) => { if (step.id === failOn) throw new Error("simuleret afbrydelse"); return { ok: true, step: step.id }; } };
    const first = await executeUpdate({ plan, store, keyring, executors, authorization: { humanSubject: HUMAN.id, stepIds }, snapshotDir, targetComponents, at: REPORT_GENERATED_AT });
    if (recovery) {
      steps.push(stepResult("upgrade", first.ok === false ? "resumable" : "ok"));
      if (first.ok !== false) problems.push("den simulerede afbrydelse blev ikke registreret");
      failOn = null;
      const rolled = rollbackUpdate({ store, updateId: plan.metadata.name, destDir: join(work, "restored"), at: REPORT_GENERATED_AT });
      steps.push(stepResult("recover", rolled.status === "rolled-back" ? "rolled-back" : "blocked"));
      if (rolled.status !== "rolled-back") problems.push("rollback blev ikke gennemført");
      if (store.getActiveRelease() !== from) problems.push("rollback gendannede ikke den forrige release");
    } else {
      if (first.ok !== true && first.code !== "APPROVAL_REQUIRED") {
        const resumed = await resumeUpdate({ plan, store, keyring, executors, authorization: { humanSubject: HUMAN.id, stepIds }, targetComponents, at: REPORT_GENERATED_AT });
        if (!resumed.ok) problems.push(`opdateringen fejlede: ${resumed.error}`);
      }
      steps.push(stepResult("upgrade", store.getActiveRelease() === to ? "ok" : "blocked"));
      if (store.getActiveRelease() !== to) problems.push("den aktive release blev ikke opdateret");
    }
    steps.push(stepResult("verify", problems.length === 0 ? "ok" : "blocked"));
    return outcomeFor(scenario, steps, problems, { from, to, activeRelease: store.getActiveRelease() });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function runProviderScenario(scenario) {
  const steps = [];
  const problems = [];
  const work = mkdtempSync(join(tmpdir(), "dkc062-provider-"));
  let cleanup = () => {};
  try {
    const all = loadProviderAll(repoRoot);
    const fixtures = loadSwapFixtures(repoRoot).map((f) => f.fixture);
    const fixture = fixtures.find((f) => f.id === "storage-filesystem-to-object-store") ?? fixtures[0];
    const store = FileProviderStore.open(join(work, "store"));
    cleanup = () => rmSync(work, { recursive: true, force: true });
    for (const provider of all.providers.providers) store.addCredential({ id: `${provider.id}-svc`, provider: provider.id, tenantId: "acme", secretRef: `vault://providers/${provider.id}` });
    const preflight = preflightSwap({ providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from: fixture.from, to: fixture.to });
    if (!preflight.allowed) problems.push(`provider-preflight blokerede det valgte skift: ${preflight.problems.map((p) => p.code).join(", ")}`);
    const approval = recordApproval({ store, principal: PROVIDER_HUMAN, tenantId: fixture.tenantId, appId: fixture.appId, contentApproved: true, aclApproved: true, evidenceRef: "evidence://acceptance/provider", at: REPORT_GENERATED_AT });
    const { reconciliation, receipt } = executeSwap({ store, fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PROVIDER_HUMAN, approval, at: REPORT_GENERATED_AT, snapshotDir: join(work, "snapshot") });
    if (!reconciliation.checksums.match) problems.push("provider-skiftets checksums afstemmer ikke");
    if (!reconciliation.references.preserved) problems.push("provider-skiftet bevarede ikke referencesporet");
    steps.push(stepResult("provider-switch", reconciliation.checksums.match ? "ok" : "blocked", `${fixture.from}->${fixture.to}`));
    const rolled = rollbackSwap({ store, receipt, destDir: join(work, "rollback"), at: REPORT_GENERATED_AT });
    if (rolled.status !== "rolled-back") problems.push("provider-rollback blev ikke gennemført");
    steps.push(stepResult("verify", problems.length === 0 ? "ok" : "blocked"));
    return outcomeFor(scenario, steps, problems, { from: fixture.from, to: fixture.to, receiptStatus: receipt.status });
  } catch (error) {
    problems.push(`provider-skift fejlede: ${error.message}`);
    steps.push(stepResult("provider-switch", "blocked"));
    steps.push(stepResult("verify", "blocked"));
    return outcomeFor(scenario, steps, problems);
  } finally {
    cleanup();
  }
}

async function runExitScenario(scenario) {
  const steps = [];
  const problems = [];
  const { all, coverage, store, cleanup } = setupMigration({ at: REPORT_GENERATED_AT });
  try {
    const source = all.sources.sources.find((s) => s.id === "files-acme");
    const objects = all.corpus.objects.filter((o) => o.appId === source.appId && o.tenantId === source.tenantId);
    importBatch({ store, source, objects, coverage, at: REPORT_GENERATED_AT });
    const exported = buildExport({ store, tenantId: "acme", appId: "files", coverage, at: REPORT_GENERATED_AT });
    const written = writeExport({ dir: join(store.root, "export-files"), exported });
    if (written.manifest.recordCount !== objects.length) problems.push("eksportens antal stemmer ikke");
    if (!written.manifest.includes?.acl) problems.push("eksporten mangler ACL-facetten");
    steps.push(stepResult("export", "ok", `${written.manifest.recordCount} poster`));
    steps.push(stepResult("verify", problems.length === 0 ? "ok" : "blocked"));
    return outcomeFor(scenario, steps, problems, { files: written.manifest.files.map((f) => f.path) });
  } finally {
    cleanup();
  }
}

/**
 * Kør alle scenarier for et scenariesæt. Returnerer maskinlæsbare udfald.
 */
export async function runAcceptanceScenarios(root = repoRoot, { scenarioSet, keyring, config, hostScopeBase, platforms } = {}) {
  const matrix = platforms ?? loadPlatformList(root);
  const selected = scenarioSet ?? JSON.parse(readFileSync(join(root, "distribution", "acceptance", "scenarios.json"), "utf8"));
  const outcomes = [];
  for (const scenario of selected.scenarios) {
    let outcome;
    if (scenario.journey === "configure") outcome = await runConfigureScenario(scenario, { keyring, config, hostScopeBase, platforms: matrix, root });
    else if (scenario.journey === "add-remove" && scenario.steps.some((s) => s.action === "remove")) outcome = await runRemoveScenario(scenario, { keyring, config, hostScopeBase, platforms: matrix, root });
    else if (scenario.journey === "upgrade") outcome = await runUpgradeScenario(scenario, { keyring, config, root });
    else if (scenario.journey === "recovery") outcome = await runUpgradeScenario(scenario, { keyring, config, root }, { recovery: true });
    else if (scenario.journey === "provider-switch") outcome = await runProviderScenario(scenario);
    else if (scenario.journey === "exit") outcome = await runExitScenario(scenario);
    else outcome = await runInstallScenario(scenario, { keyring, config, hostScopeBase, platforms: matrix, root });
    outcomes.push(outcome);
  }
  return outcomes;
}
