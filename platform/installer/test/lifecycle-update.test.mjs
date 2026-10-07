import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, verifyReleaseCatalog } from "../src/lifecycle-model.mjs";
import { buildUpdatePlan, verifyUpdatePlan, executeUpdate, resumeUpdate, rollbackUpdate, updateImpact } from "../src/lifecycle-update.mjs";
import { FileLifecycleStore } from "../src/lifecycle-store.mjs";
import { updatePlanProblems } from "../src/lifecycle-model.mjs";

const keyring = JSON.parse(readFileSync(join(repoRoot, "configuration/dev-keyring.json"), "utf8"));
const profile = JSON.parse(readFileSync(join(repoRoot, "catalog/profiles/small-vps.profile.json"), "utf8"));
const all = loadAll(repoRoot);
const AT = "2026-03-01T00:00:00Z";
const from = all.catalog.releases.find((r) => r.id === "1.3.0");
const to = all.catalog.releases.find((r) => r.id === "1.4.0");

function makePlan(overrides = {}) {
  return buildUpdatePlan({
    installationId: "acme-prod",
    fromRelease: "1.3.0",
    toRelease: "1.4.0",
    catalog: all.catalog,
    components: all.components,
    profile,
    keyring,
    approval: { humanSubject: "oidc|ada.acme", approvalRef: "approval://update/1", twoPerson: true },
    now: AT,
    ...overrides,
  });
}

test("opdateringsplanen er signeret og validerer semantisk", () => {
  const plan = makePlan();
  assert.equal(verifyUpdatePlan(plan, keyring).ok, true);
  assert.equal(updatePlanProblems(plan, { now: Date.parse(AT) }).length, 0);
  assert.equal(plan.preflight.ok, true);
  assert.ok(plan.steps.some((s) => s.mutating && s.requiresApproval));
});

test("en manipuleret opdateringsplan afvises", () => {
  const plan = makePlan();
  const tampered = structuredClone(plan);
  tampered.restrictions.formatDisks = true;
  assert.equal(verifyUpdatePlan(tampered, keyring).ok, false);
});

test("påvirkningsplanen viser alle opgraderinger fra låsen", () => {
  const impact = updateImpact({ fromRelease: from, toRelease: to, components: all.components });
  assert.ok(impact.upgraded.length >= 5);
  assert.deepEqual(impact.removed, []);
});

test("et muterende trin uden menneskelig godkendelse afvises", async () => {
  const plan = makePlan();
  const root = mkdtempSync(join(tmpdir(), "dkc061-upd-"));
  try {
    const store = FileLifecycleStore.open(join(root, "store"));
    const result = await executeUpdate({ plan, store, keyring, executors: { run: async () => ({ ok: true }) }, authorization: null, snapshotDir: join(root, "snap"), targetComponents: to.compatibilityLock, at: AT });
    assert.equal(result.ok, false);
    assert.equal(result.code, "APPROVAL_REQUIRED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("en afbrudt opdatering kan genoptages og rulles tilbage", async () => {
  const plan = makePlan();
  const stepIds = plan.steps.filter((s) => s.mutating).map((s) => s.id);
  const root = mkdtempSync(join(tmpdir(), "dkc061-upd-"));
  try {
    const store = FileLifecycleStore.open(join(root, "store"));
    store.setActiveRelease("1.3.0", { at: AT });
    store.setComponents({ ...from.compatibilityLock }, { at: AT });
    const snapshotDir = join(root, "snapshot");
    let failOn = "migrate-schema";
    const executors = { run: async (step) => { if (step.id === failOn) throw new Error("afbrydelse"); return { ok: true }; } };
    const interrupted = await executeUpdate({ plan, store, keyring, executors, authorization: { humanSubject: "oidc|ada.acme", stepIds }, snapshotDir, targetComponents: to.compatibilityLock, at: AT });
    assert.equal(interrupted.ok, false);
    failOn = null;
    const resumed = await resumeUpdate({ plan, store, keyring, executors, authorization: { humanSubject: "oidc|ada.acme", stepIds }, targetComponents: to.compatibilityLock, at: AT });
    assert.equal(resumed.ok, true);
    assert.equal(store.getActiveRelease(), "1.4.0");
    const rolled = rollbackUpdate({ store, updateId: plan.metadata.name, destDir: join(root, "restored"), at: AT });
    assert.equal(rolled.status, "rolled-back");
    assert.equal(rolled.restoredRelease, "1.3.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("releasekatalogets signatur og digest verificeres", () => {
  assert.equal(verifyReleaseCatalog(all.catalog, keyring).ok, true);
  const broken = structuredClone(all.catalog);
  broken.releases[0].digest = "f".repeat(64);
  assert.equal(verifyReleaseCatalog(broken, keyring).ok, false);
});
