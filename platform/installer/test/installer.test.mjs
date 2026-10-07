import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { repoRoot } from "../../configuration/src/model.mjs";
import { hostSupported, runPreflight } from "../src/preflight.mjs";
import { buildInstallerPlan, signPlan, verifyPlanSignature, planDigest, installerPlanProblems } from "../src/plan.mjs";
import { createInstallStateStore } from "../src/state.mjs";
import { runInstaller, resumeInstaller, createStepExecutors } from "../src/run.mjs";
import { buildDiagnostics, redactSecrets, scanForSecrets } from "../src/diagnostics.mjs";

const hostScope = JSON.parse(readFileSync(join(repoRoot, "configuration/host-scope.json"), "utf8"));
const config = JSON.parse(readFileSync(join(repoRoot, "configuration/desired-state.json"), "utf8"));
const platforms = JSON.parse(readFileSync(join(repoRoot, "catalog/platforms.json"), "utf8")).platforms ?? [];
const keyring = { keys: [{ keyId: "test-key", secret: "test-secret" }] };

function testPlan({ now = "2026-09-24T08:05:00Z" } = {}) {
  const preflight = runPreflight({ hostScope, platformMatrix: platforms, config, configDigest: "a".repeat(64), disks: [], existingDatabase: null });
  const plan = buildInstallerPlan({
    installationId: "acme-prod",
    profile: { metadata: { name: "small-vps" } },
    platformId: "linux-amd64-node22",
    hostScope,
    configDigest: "a".repeat(64),
    preview: { result: { closure: ["platform-core"] } },
    preflight,
    components: [{ metadata: { name: "platform-core" }, componentType: "security-core" }],
    now,
  });
  return { plan, signed: signPlan(plan, { keyId: "test-key", secret: "test-secret", signedAt: now }) };
}

test("hostSupported afviser ikke-understøttede OS-versioner", () => {
  assert.equal(hostSupported(hostScope, platforms).ok, true);
  const unsupported = structuredClone(hostScope);
  unsupported.os.supportTier = "unsupported";
  assert.equal(hostSupported(unsupported, platforms).ok, false);
  const unknown = structuredClone(hostScope);
  unknown.os.supportedMatrixRef = "does-not-exist";
  assert.equal(hostSupported(unknown, platforms).ok, false);
});

test("preflight blokerer diskformatering, databaseovertagelse og root til agenter", () => {
  const ok = runPreflight({ hostScope, platformMatrix: platforms, config, configDigest: "a".repeat(64) });
  assert.equal(ok.ok, true, JSON.stringify(ok.blockingProblems));

  const format = runPreflight({ hostScope, platformMatrix: platforms, disks: [{ id: "os", formatRequested: true }] });
  assert.equal(format.ok, false);
  assert.ok(format.blockingProblems.some((p) => p.includes("formatering")));

  const takeover = runPreflight({
    hostScope,
    platformMatrix: platforms,
    existingDatabase: { schemaPresent: true, ownedBySubject: "oidc|someone-else", backupVerified: false },
  });
  assert.equal(takeover.ok, false);

  const root = structuredClone(hostScope);
  root.privileges.noRootForAgents = false;
  const rootResult = runPreflight({ hostScope: root, platformMatrix: platforms });
  assert.equal(rootResult.ok, false);
});

test("signaturen dækker planen og afviser ændringer og ukendte nøgler", () => {
  const { signed } = testPlan();
  assert.equal(verifyPlanSignature(signed, keyring).ok, true);
  const tampered = structuredClone(signed);
  tampered.restrictions.changeHostOs = true;
  assert.equal(verifyPlanSignature(tampered, keyring).ok, false);
  assert.equal(verifyPlanSignature(signed, { keys: [] }).ok, false);
  const revoked = { keys: [{ keyId: "test-key", secret: "test-secret", revokedAt: "2026-09-24T09:00:00Z" }] };
  assert.equal(verifyPlanSignature(signed, revoked).ok, false);
});

test("et muterende trin uden godkendelse afvises", () => {
  const { plan } = testPlan();
  const broken = structuredClone(plan);
  broken.steps.find((s) => s.mutating).requiresApproval = false;
  assert.ok(installerPlanProblems(broken).some((p) => p.path.endsWith("/requiresApproval")));
});

test("tilstandsstore nægter at genoptage en anden plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc054-state-"));
  const store = createInstallStateStore({ path: join(dir, "state.json") });
  store.ensure({ installationId: "acme-prod", planDigest: "a".repeat(64) });
  assert.throws(() => store.ensure({ installationId: "acme-prod", planDigest: "b".repeat(64) }), /anden plan/);
  rmSync(dir, { recursive: true, force: true });
});

test("afbrudt installation genoptages idempotent", async () => {
  const { signed } = testPlan();
  const dir = mkdtempSync(join(tmpdir(), "dkc054-run-"));
  const store = createInstallStateStore({ path: join(dir, "state.json") });
  const calls = [];
  let failOnce = true;
  const handlers = {};
  for (const step of signed.steps) {
    handlers[step.id] = () => {
      calls.push(step.id);
      if (step.kind === "configure" && failOnce) {
        failOnce = false;
        throw new Error("midlertidig fejl");
      }
      return { idempotencyKey: step.idempotencyKey };
    };
  }
  const executors = createStepExecutors(handlers);
  const authorization = { humanSubject: "oidc|anna.andersen", stepIds: signed.steps.filter((s) => s.mutating).map((s) => s.id) };
  const first = await runInstaller({ plan: signed, store, executors, keyring, verifySignature: true, authorization });
  assert.equal(first.ok, false);
  assert.equal(first.code, "STEP_FAILED");
  const beforeResume = calls.length;

  const second = await resumeInstaller({ plan: signed, store, executors, keyring, verifySignature: true, authorization });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.status.status, "done");
  // De allerede fuldførte trin køres ikke igen.
  assert.ok(calls.length - beforeResume < signed.steps.length);
  assert.equal(new Set(calls).size, signed.steps.length);
  rmSync(dir, { recursive: true, force: true });
});

test("muterende trin kræver menneskelig godkendelse ved kørsel", async () => {
  const { signed } = testPlan();
  const dir = mkdtempSync(join(tmpdir(), "dkc054-approval-"));
  const store = createInstallStateStore({ path: join(dir, "state.json") });
  const executors = createStepExecutors(Object.fromEntries(signed.steps.map((s) => [s.id, () => true])));
  const result = await runInstaller({ plan: signed, store, executors, keyring });
  assert.equal(result.code, "APPROVAL_REQUIRED");
  rmSync(dir, { recursive: true, force: true });
});

test("diagnostik redigerer hemmeligheder og blokerer på signaturer", () => {
  assert.equal(redactSecrets({ apiKey: "abc", nested: { password: "x" } }).apiKey, "[REDACTED]");
  assert.equal(redactSecrets({ nested: { password: "x" } }).nested.password, "[REDACTED]");
  const bundle = buildDiagnostics({ artifactRef: "diagnostics://x", payload: { token: "abc", safe: "ok" } });
  assert.equal(bundle.secretScan, "pass");
  assert.equal(bundle.content.token, "[REDACTED]");
  assert.throws(() => buildDiagnostics({ artifactRef: "diagnostics://x", payload: { leaked: "-----BEGIN RSA PRIVATE KEY-----" } }), /hemmelighedssignaturer/);
  assert.ok(scanForSecrets("sk-abcdefghijklmnopqrstuvwxyz").length > 0);
});

test("planens digest er deterministisk for samme input", () => {
  const a = testPlan().signed;
  const b = testPlan().signed;
  assert.equal(planDigest(a), planDigest(b));
});
