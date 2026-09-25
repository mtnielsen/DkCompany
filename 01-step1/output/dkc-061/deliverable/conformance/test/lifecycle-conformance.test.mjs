/**
 * DKC-061 — konformanstest for produktlivscyklussen.
 *
 * Tester skema + semantik på det faktiske releasekatalog, supportpolitik,
 * offlinepakke, eksempler og den genererede rapport, og at et brud afvises. En
 * rigtig opdatering eller fjernelse på en levende installation er og forbliver
 * NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import {
  validateReleaseCatalog,
  validateLifecycleUpdatePlan,
  validateLifecycleRemovalPlan,
  validateSupportBundlePolicy,
  validateSupportBundle,
  validateOfflinePackage,
} from "../src/lifecycle.mjs";
import {
  loadAll,
  verifyReleaseCatalog,
  releaseCatalogProblems,
  supportPolicyProblems,
  offlinePackageProblems,
  updatePlanProblems,
  removalPlanProblems,
  supportBundleProblems,
} from "../../installer/src/lifecycle-model.mjs";
import { buildSupportBundle } from "../../installer/src/lifecycle-support.mjs";
import { buildUpdatePlan } from "../../installer/src/lifecycle-update.mjs";
import { buildRemovalPlan } from "../../installer/src/lifecycle-remove.mjs";
import { offlineReadiness } from "../../installer/src/lifecycle-offline.mjs";
import { decideLifecycleAccess } from "../../installer/src/lifecycle-permissions.mjs";
import { runLifecycleCheck } from "../../installer/src/lifecycle-check.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const all = loadAll(repoRoot);
const keyring = read("configuration/dev-keyring.json");
const profile = read("catalog/profiles/small-vps.profile.json");
const report = read("lifecycle/report/lifecycle-report.json");

test("det faktiske releasekatalog validerer og er signeret", () => {
  assert.equal(validateReleaseCatalog(all.catalog, undefined, { keyring, components: all.components, now: Date.parse("2026-03-01T00:00:00Z") }).ok, true);
  assert.equal(verifyReleaseCatalog(all.catalog, keyring).ok, true);
});

test("supportpolitikken og offlinepakken validerer", () => {
  assert.equal(validateSupportBundlePolicy(all.support).ok, true);
  assert.equal(validateOfflinePackage(all.offline, undefined, { components: all.components, routes: all.routes }).ok, true);
  assert.equal(all.support.policy.hiddenRemoteAccessAllowed, false);
  assert.equal(all.support.policy.remoteAccessDefaultDeny, true);
});

test("eksemplerne validerer (skema + semantik hvor relevant)", () => {
  assert.equal(validateReleaseCatalog(read("contracts/examples/release-catalog.example.json"), undefined, { keyring, now: Date.parse("2026-03-01T00:00:00Z") }).ok, true);
  assert.equal(validateLifecycleUpdatePlan(read("contracts/examples/lifecycle-update-plan.example.json")).ok, true);
  assert.equal(validateLifecycleRemovalPlan(read("contracts/examples/lifecycle-removal-plan.example.json")).ok, true);
  assert.equal(validateSupportBundlePolicy(read("contracts/examples/support-bundle-policy.example.json")).ok, true);
  assert.equal(validateSupportBundle(read("contracts/examples/support-bundle.example.json")).ok, true);
  assert.equal(validateOfflinePackage(read("contracts/examples/offline-package.example.json")).ok, true);
});

test("den genererede rapport er deterministisk og alle scenarier består", () => {
  assert.equal(report.measured, false);
  assert.equal(report.generatedAt, "2026-03-01T00:00:00Z");
  assert.ok(report.scenarios.every((s) => (s.problems ?? []).length === 0));
  assert.ok(report.totals.releases >= 4);
});

test("den fulde livscykluskontrol består deterministisk", async () => {
  const result = await runLifecycleCheck(repoRoot);
  assert.equal(result.ok, true, result.problems.join("; "));
});

test("et manipuleret releasekatalog afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.catalog));
  broken.releases[0].compatibilityLock["platform-core"] = "9.9.9";
  const res = verifyReleaseCatalog(broken, keyring);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => /signatur|digest/.test(p)));
});

test("en stable-release med en forkert låst version afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.catalog));
  broken.releases.find((r) => r.channel === "stable").compatibilityLock["platform-core"] = "1.0.0";
  assert.ok(releaseCatalogProblems(broken, { components: all.components, now: Date.parse("2026-03-01T00:00:00Z") }).some((p) => /låser/.test(p.message)));
});

test("en EOL-release uden håndtering afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.catalog));
  broken.releases.find((r) => r.channel === "eol").handling = null;
  const res = validateReleaseCatalog(broken, undefined, { keyring, now: Date.parse("2026-03-01T00:00:00Z") });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /håndtering/.test(e.message)));
});

test("en opdatering til en tilbagekaldt release afvises", () => {
  const plan = buildUpdatePlan({ installationId: "acme-prod", fromRelease: "1.3.0", toRelease: "1.1.0", catalog: all.catalog, components: all.components, profile, keyring, approval: { humanSubject: "oidc|ada.acme", approvalRef: "approval://x", twoPerson: true }, now: "2026-03-01T00:00:00Z" });
  assert.equal(plan.preflight.ok, false);
  assert.ok(plan.preflight.blockingProblems.some((p) => /må ikke køres/.test(p)));
});

test("en opdateringsplan uden rollback afvises", () => {
  const plan = buildUpdatePlan({ installationId: "acme-prod", fromRelease: "1.3.0", toRelease: "1.4.0", catalog: all.catalog, components: all.components, profile, keyring, approval: { humanSubject: "oidc|ada.acme", approvalRef: "approval://x", twoPerson: true }, now: "2026-03-01T00:00:00Z" });
  const broken = JSON.parse(JSON.stringify(plan));
  broken.rollback.strategy = "none";
  assert.ok(updatePlanProblems(broken).some((p) => p.path === "/rollback/strategy"));
});

test("fjernelse af en delt database afvises", () => {
  const plan = buildRemovalPlan({ installationId: "acme-prod", removeId: "primary-database", mode: "remove-only", components: all.components, profile, installed: { hr: "1.4.0" }, now: "2026-03-01T00:00:00Z" });
  assert.equal(plan.blocking, true);
  assert.ok(plan.preflight.blockingProblems.some((p) => /delt afhængighed/.test(p)));
});

test("almindelig afinstallering bevarer data", () => {
  const plan = buildRemovalPlan({ installationId: "acme-prod", removeId: "communications", mode: "remove-only", components: all.components, profile, installed: {}, now: "2026-03-01T00:00:00Z" });
  assert.equal(removalPlanProblems(plan).length, 0);
  assert.equal(plan.dataDisposition.preserve, true);
});

test("datasletning uden eksport/backup afvises", () => {
  const plan = buildRemovalPlan({ installationId: "acme-prod", removeId: "communications", mode: "remove-and-delete-data", components: all.components, profile, installed: {}, approval: { humanSubject: "oidc|ada.acme", secondHumanSubject: "oidc|ben.acme", approvalRef: "approval://y", destructiveApproved: true }, now: "2026-03-01T00:00:00Z" });
  assert.equal(plan.preflight.ok, false);
  assert.ok(plan.preflight.blockingProblems.some((p) => /eksport/.test(p)));
});

test("en supportbundle med en rå hemmelighed afvises", () => {
  assert.throws(() => buildSupportBundle({ policy: all.support, installationId: "acme-prod", sources: { "installer-status": { note: "sk-abcdefghijklmnopqrstuvwxyz" } }, at: "2026-03-01T00:00:00Z" }), /hemmelighed/);
});

test("en supportbundle med HR-indhold afvises", () => {
  assert.throws(() => buildSupportBundle({ policy: all.support, installationId: "acme-prod", sources: { "component-versions": { salary: 42000 } }, at: "2026-03-01T00:00:00Z" }), /HR/);
});

test("en supportbundle uden consent til fjernadgang afvises", () => {
  assert.throws(() => buildSupportBundle({ policy: all.support, installationId: "acme-prod", sources: {}, remoteAccess: { enabled: true }, at: "2026-03-01T00:00:00Z" }), /samtykke/);
});

test("offlineberedskabet bevarer lokale kerneflows og viser eksterne afhængigheder", () => {
  const readiness = offlineReadiness(all.offline, { online: false });
  assert.equal(readiness.coreFlowsRemainLocal, true);
  assert.ok(readiness.localFlows.length >= 3);
  assert.ok(readiness.external.every((e) => e.message && e.message.length > 0));
  assert.ok(readiness.external.some((e) => !e.available));
});

test("adgang er default-deny og tenantadskilt", () => {
  const ada = { id: "oidc|ada.acme", tenantId: "acme", roles: ["lifecycle-admin"] };
  const gus = { id: "oidc|gus.globex", tenantId: "globex", roles: ["lifecycle-admin"] };
  const auditor = { id: "oidc|ida.auditor", tenantId: "acme", roles: ["lifecycle-auditor"] };
  assert.equal(decideLifecycleAccess({ principal: gus, tenantId: "acme", action: "read" }).allowed, false);
  assert.equal(decideLifecycleAccess({ principal: auditor, tenantId: "acme", action: "update" }).allowed, false);
  assert.equal(decideLifecycleAccess({ principal: ada, tenantId: "acme", action: "update" }).allowed, true);
});
