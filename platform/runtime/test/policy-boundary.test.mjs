/**
 * DKC-007 — accepttests for de skærpede runtimegrænser.
 *
 * Dækker:
 *   - ukendt eller tom PDP-beslutning afvises (fail-closed)
 *   - capability til module/child giver ikke adgang til module (ensrettet scope)
 *   - staging-agent kan ikke operere i prod
 *   - aliaser, case, encoding og nye muterende verber omgår ikke A4
 *   - en tests-pass-streng uden verificerbart testresultat accepteres ikke
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime, RuntimeBoundaryError } from "../src/runtime.mjs";
import { createMemoryAuditLog } from "../src/clients.mjs";
import { validatePolicyDecision } from "../src/boundary.mjs";
import { createPdp } from "../../policy/pdp/src/pdp.mjs";
import { evidenceFixture } from "./evidence-fixtures.mjs";
import { validDecision } from "./pdp-fixtures.mjs";

const baseManifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const manifest = () => structuredClone(baseManifest);

const task = (actions, extra = {}) => ({
  apiVersion: "contracts.platform/v1alpha1",
  kind: "AgentTask",
  taskId: randomUUID(),
  tenantId: "acme",
  agentRef: "dummy-ok-upgrader",
  objective: "dkc-007",
  actions,
  ...extra,
});

function runtimeWith({ pdp, manifest: m = manifest(), record = [], evidenceIndex, artifactLoader } = {}) {
  return createAgentRuntime({
    manifest: m,
    pdp: pdp ?? { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog: createMemoryAuditLog(),
    executors: {
      "observe.read": async () => { record.push("observe.read"); return { summary: "read" }; },
      "upgrade.dry-run": async () => { record.push("upgrade.dry-run"); return { summary: "clean" }; },
      "upgrade.patch": async () => { record.push("upgrade.patch"); return { summary: "patched" }; },
      "upgrade.hotfix": async () => { record.push("upgrade.hotfix"); return { summary: "hotfixed" }; },
    },
    ...(evidenceIndex ? { evidenceIndex } : {}),
    ...(artifactLoader ? { artifactLoader } : {}),
  });
}

const action = (extra = {}) => ({ verb: "observe.read", target: "dummy-ok", environment: "staging", evidence: ["policy-allow"], ...extra });

/* --- PDP-svar ----------------------------------------------------------- */

test("tomt PDP-svar afvises før executor", async () => {
  const record = [];
  const runtime = runtimeWith({ pdp: { decide: async () => ({}) }, record });
  const result = await runtime.runTask(task([action()]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /PDP-beslutning/);
  assert.deepEqual(record, []);
});

test("ukendt beslutning afvises", async () => {
  const record = [];
  const runtime = runtimeWith({ pdp: { decide: async () => ({ decision: "maybe" }) }, record });
  const result = await runtime.runTask(task([action()]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /ukendt/);
  assert.deepEqual(record, []);
});

test("PDP-svar der ikke er bundet til input afvises", async () => {
  const record = [];
  const runtime = runtimeWith({ pdp: { decide: async () => validDecision({}, { inputSha256: "f".repeat(64) }) }, record });
  const result = await runtime.runTask(task([action()]));
  assert.equal(result.status, "halted");
  assert.match(result.reason, /binding|input/);
  assert.deepEqual(record, []);
});

/* --- Scope og miljø ------------------------------------------------------ */

test("capability til module/child giver ikke adgang til module", async () => {
  const record = [];
  const m = manifest();
  m.capabilities.push({ verb: "scale", target: "dummy-ok/child", autonomyClass: "A2", requiredEvidence: ["policy-allow"] });
  const runtime = runtimeWith({ manifest: m, record });
  const result = await runtime.runTask(task([action({ verb: "scale", target: "dummy-ok" })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /scope/);
  assert.deepEqual(record, [], "forælderen må ikke åbnes af et child-scope");
});

test("staging-agent kan ikke operere i prod", async () => {
  const record = [];
  const runtime = runtimeWith({ record });
  const result = await runtime.runTask(task([action({ environment: "prod" })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /miljø|scope/);
  assert.deepEqual(record, []);
});

test("datakategori uden for manifestets scope afvises", async () => {
  const record = [];
  const runtime = runtimeWith({ record });
  const result = await runtime.runTask(task([action({ dataCategories: ["personal"] })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /datakategori/);
  assert.deepEqual(record, []);
});

test("agentRef-mismatch afvises", async () => {
  const record = [];
  const runtime = runtimeWith({ record });
  const result = await runtime.runTask(task([action()], { agentRef: "some-other-agent" }));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /agentRef/);
  assert.deepEqual(record, []);
});

/* --- A4: aliaser, case, encoding, nye verber ----------------------------- */

test("A4 kan ikke omgås med case, aliaser, encoding eller sti-tricks", async () => {
  const bypasses = ["POLICY/Bundles", "policy%2Fbundles", "policy/./bundles", "policy//bundles", "audit_service", "governance/rights", "res://acme/policy/7"];
  for (const target of bypasses) {
    const record = [];
    const runtime = runtimeWith({ record });
    const result = await runtime.runTask(task([action({ verb: "upgrade.patch", target })]));
    assert.equal(result.status, "refused", `target ${target} skulle være A4-afvist`);
    assert.match(result.reason, /A4/, `target ${target}`);
    assert.deepEqual(record, [], `target ${target} må ikke udføres`);
  }
});

test("et nyt muterende verbum omgår ikke A4", async () => {
  const record = [];
  const m = manifest();
  m.scope.ownedComponents.push("policy");
  m.capabilities.push({ verb: "upgrade.hotfix", target: "policy", autonomyClass: "A3", requiredEvidence: ["policy-allow"] });
  const runtime = runtimeWith({ manifest: m, record });
  const result = await runtime.runTask(task([action({ verb: "upgrade.hotfix", target: "policy/bundles/platform" })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /A4/);
  assert.deepEqual(record, []);
});

/* --- Evidens ------------------------------------------------------------- */

test("en tests-pass-streng uden reference accepteres ikke", async () => {
  const record = [];
  const pdp = { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow", "tests-pass"] }) };
  const runtime = runtimeWith({ pdp, record });
  const result = await runtime.runTask(task([action({ verb: "upgrade.dry-run", evidence: ["policy-allow", "tests-pass"] })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /evidens/i);
  assert.deepEqual(record, []);
});

test("en tests-pass-reference med matchende digest accepteres og bindes", async () => {
  const record = [];
  const { index } = evidenceFixture(["tests-pass"]);
  const pdp = { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow", "tests-pass"] }) };
  const runtime = runtimeWith({ pdp, record, evidenceIndex: index });
  const result = await runtime.runTask(task([action({ verb: "upgrade.dry-run", evidence: ["policy-allow", "tests-pass"] })]));
  assert.equal(result.status, "completed");
  assert.deepEqual(record, ["upgrade.dry-run"]);
});

test("en tests-pass-reference med forkert digest afvises", async () => {
  const record = [];
  const { index } = evidenceFixture(["tests-pass"]);
  index["tests-pass"].sha256 = "0".repeat(64);
  const pdp = { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow", "tests-pass"] }) };
  const runtime = runtimeWith({ pdp, record, evidenceIndex: index });
  const result = await runtime.runTask(task([action({ verb: "upgrade.dry-run", evidence: ["policy-allow", "tests-pass"] })]));
  assert.equal(result.status, "refused");
  assert.match(result.reason, /evidens/i);
  assert.deepEqual(record, []);
});

/* --- Manifest-validering ved konstruktion -------------------------------- */

test("et ugyldigt manifest afvises ved runtimegrænsen", () => {
  const m = manifest();
  m.capabilities.push({ verb: "upgrade.patch", target: "dummy-ok", autonomyClass: "A4" });
  assert.throws(() => runtimeWith({ manifest: m }), (e) => e instanceof RuntimeBoundaryError && /autonomyClass/.test(JSON.stringify(e.violations)));
});

test("runtimens digest matcher den rigtige PDP's inputSha256", () => {
  const pdp = createPdp();
  const input = {
    principal: { kind: "agent", id: "spiffe://platform.example.org/agents/x", spiffeId: "spiffe://platform.example.org/agents/x", autonomyClass: "A3" },
    action: { verb: "upgrade", target: "dummy-ok", environment: "staging", autonomyClass: "A3" },
    context: { tenantId: "acme", evidence: ["policy-allow", "tests-pass", "dry-run-clean", "rollback-tested"], evidenceSha256: { "tests-pass": "a".repeat(64) } },
  };
  const decision = pdp.decide(input);
  assert.equal(decision.decision, "allow-with-approval");
  const check = validatePolicyDecision(decision, { input });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test("en task uden tenant afvises", async () => {
  const record = [];
  const runtime = runtimeWith({ record });
  const bad = task([action()]);
  delete bad.tenantId;
  const result = await runtime.runTask(bad);
  assert.equal(result.status, "refused");
  assert.match(result.reason, /ugyldig/);
  assert.deepEqual(record, []);
});
