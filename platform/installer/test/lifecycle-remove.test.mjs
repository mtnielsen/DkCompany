import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, removalPlanProblems } from "../src/lifecycle-model.mjs";
import { buildRemovalPlan, executeRemoval, reverseDependencies } from "../src/lifecycle-remove.mjs";
import { FileLifecycleStore } from "../src/lifecycle-store.mjs";

const profile = JSON.parse(readFileSync(join(repoRoot, "catalog/profiles/small-vps.profile.json"), "utf8"));
const all = loadAll(repoRoot);
const AT = "2026-03-01T00:00:00Z";

function plan(fields = {}) {
  return buildRemovalPlan({ installationId: "acme-prod", components: all.components, profile, installed: {}, now: AT, ...fields });
}

test("reverse-dependency-kontrollen finder de aktive moduler", () => {
  const reverse = reverseDependencies({ components: all.components, profile, installed: {}, removeId: "primary-database" });
  assert.ok(reverse.some((r) => r.id === "platform-core" && r.optional === false));
});

test("fjernelse af en delt database afvises", () => {
  const p = plan({ removeId: "primary-database", mode: "remove-only" });
  assert.equal(p.blocking, true);
  assert.ok(p.preflight.blockingProblems.some((x) => /delt afhængighed/.test(x)));
});

test("fjernelse af IAM afvises fordi sikkerhedskernen beskyttes", () => {
  const p = plan({ removeId: "identity-broker", mode: "remove-only" });
  assert.equal(p.blocking, true);
  assert.ok(p.preflight.blockingProblems.some((x) => /sikkerhedskernen/.test(x)));
});

test("almindelig afinstallering bevarer data og recoverymetadata", async () => {
  const p = plan({ removeId: "communications", mode: "remove-only" });
  assert.equal(p.blocking, false);
  assert.equal(removalPlanProblems(p).length, 0);
  assert.equal(p.dataDisposition.preserve, true);
  assert.ok(p.dataDisposition.recoveryMetadataRef);
  const root = mkdtempSync(join(tmpdir(), "dkc061-rm-"));
  try {
    const store = FileLifecycleStore.open(root);
    const run = await executeRemoval({ plan: p, store, executors: { run: async () => ({ ok: true }) }, at: AT });
    assert.equal(run.ok, true);
    assert.equal(store.getRemoval(p.metadata.name).status, "done");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("datasletning kræver eksport eller backup og to-personers-kontrol", async () => {
  const noEvidence = plan({ removeId: "communications", mode: "remove-and-delete-data", approval: { humanSubject: "oidc|ada.acme", secondHumanSubject: "oidc|ben.acme", approvalRef: "approval://d", destructiveApproved: true } });
  assert.equal(noEvidence.preflight.ok, false);
  const withEvidence = plan({ removeId: "communications", mode: "remove-and-delete-data", exportRef: "export://acme/x", backupRef: "backup://acme/x", approval: { humanSubject: "oidc|ada.acme", secondHumanSubject: "oidc|ben.acme", approvalRef: "approval://d", destructiveApproved: true } });
  assert.equal(removalPlanProblems(withEvidence).length, 0);
  const root = mkdtempSync(join(tmpdir(), "dkc061-rm-"));
  try {
    const store = FileLifecycleStore.open(root);
    const onePerson = await executeRemoval({ plan: withEvidence, store, executors: { run: async () => ({ ok: true }) }, authorization: { humanSubject: "oidc|ada.acme", secondHumanSubject: "oidc|ada.acme" }, at: AT });
    assert.equal(onePerson.code, "TWO_PERSON_REQUIRED");
    const ok = await executeRemoval({ plan: withEvidence, store, executors: { run: async () => ({ ok: true }) }, authorization: { humanSubject: "oidc|ada.acme", secondHumanSubject: "oidc|ben.acme" }, at: AT });
    assert.equal(ok.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fjernelse af den delte database afvises ved eksekvering", async () => {
  const p = plan({ removeId: "primary-database", mode: "remove-only" });
  const root = mkdtempSync(join(tmpdir(), "dkc061-rm-"));
  try {
    const store = FileLifecycleStore.open(root);
    const run = await executeRemoval({ plan: p, store, executors: { run: async () => ({ ok: true }) }, at: AT });
    assert.equal(run.ok, false);
    assert.equal(run.code, "SHARED_DEPENDENCY");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
