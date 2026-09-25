/**
 * DKC-011 — servervalideret, typet værktøjsgrænse.
 *
 * Beviser:
 *   - kun værktøjer på allowlisten kan kaldes (ingen fri shell, ingen secret-hentning),
 *   - parametre valideres mod et typeskema, størrelsesgrænser og forbudte navne,
 *   - udgående netværk følger en egress-allowlist (metadata/private/localhost afvises),
 *   - data kan ikke flyttes til en anden kunde,
 *   - en executor kaldes aldrig for et afvist kald.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog } from "../src/clients.mjs";
import { createToolBoundary, resolveTool, validateEgress, validateParams, validateToolCall } from "../src/tools.mjs";
import { digestOf } from "../src/digest.mjs";

const baseManifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const manifest = () => structuredClone(baseManifest);
const pdp = { decide: async (input) => ({ decision: "allow", pdp: { name: "test", version: "1", bundleVersion: "1" }, matchedRules: ["r"], inputSha256: digestOf(input), requiredEvidence: ["policy-allow"] }) };

const strictBoundary = createToolBoundary({ allowGeneric: false });

/* --- Allowlist ----------------------------------------------------------- */

test("ukendte værktøjer og verber uden for allowlisten afvises", () => {
  assert.equal(validateToolCall({ verb: "observe.read", tool: "not.a.tool" }).ok, false);
  const missing = validateToolCall({ verb: "definitely.not.a.verb", allowGeneric: false });
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0].message, /intet typet værktøj/);
});

test("fri shell-verber afvises, selv når de erklæres i et manifest", () => {
  for (const verb of ["shell.exec", "bash", "os.system", "subprocess.spawn", "eval"]) {
    const check = validateToolCall({ verb });
    assert.equal(check.ok, false, `${verb} skulle afvises`);
    assert.match(check.errors[0].message, /shell|eval/i);
  }
});

test("secret-hentende verber afvises, men rotate-credential er tilladt", () => {
  for (const verb of ["fetch-secret", "get.token", "read-credential", "export.apikey"]) {
    const check = validateToolCall({ verb });
    assert.equal(check.ok, false, `${verb} skulle afvises`);
    assert.match(check.errors[0].message, /secret/i);
  }
  assert.equal(validateToolCall({ verb: "rotate-credential", params: { credentialRef: "kms://acme/db" } }).ok, true);
});

/* --- Parametre ----------------------------------------------------------- */

test("parametre valideres mod typeskemaet", () => {
  const bad = validateToolCall({ verb: "observe.read", params: { windowMinutes: "mange" } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /integer/.test(e.message)));

  const badEnum = validateToolCall({ verb: "observe.read", params: { format: "xml" } });
  assert.equal(badEnum.ok, false);

  const unknown = validateToolCall({ verb: "observe.read", params: { hemmeligtFelt: 1 } });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((e) => /ukendt felt/.test(e.message)));

  const good = validateToolCall({ verb: "observe.read", params: { windowMinutes: 30, format: "json" } });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
});

test("farlige parameternavne afvises rekursivt", () => {
  for (const key of ["command", "shell", "token", "password", "private_key"]) {
    const check = validateToolCall({ verb: "upgrade.patch", params: { nested: { [key]: "x" } } });
    assert.equal(check.ok, false, `${key} skulle afvises`);
    assert.ok(check.errors.some((e) => /forbudt/.test(e.message)), key);
  }
});

test("størrelsesgrænsen håndhæves på de serialiserede parametre", () => {
  const huge = { parameters: { blob: "x".repeat(9000) } };
  const check = validateToolCall({ verb: "upgrade.patch", params: huge });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /bytes|større/.test(e.message)), JSON.stringify(check.errors));
});

test("validateParams rapporterer sti og type", () => {
  const errors = validateParams({ type: "object", properties: { a: { type: "number", minimum: 5 } } }, { a: 1 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, "/parameters/a");
});

/* --- Egress -------------------------------------------------------------- */

test("værktøjer uden netværksadgang afviser URL-parametre", () => {
  const check = validateEgress({ tool: { name: "x", egress: { network: false } }, params: { endpoint: "https://evil.example.net" } });
  assert.equal(check.ok, false);
  assert.match(check.errors[0].message, /ingen udgående netværksadgang/);
});

test("uautoriserede værter, skemaer og metadata-adresser afvises", () => {
  const tool = { name: "upgrade.apply", egress: { network: true, allowedSchemes: ["https"], allowedHosts: ["module.dummy-ok.svc.platform.example.org"] } };
  assert.equal(validateEgress({ tool, params: { endpoint: "https://evil.example.net/collect" }, tenantId: "acme" }).ok, false);
  assert.equal(validateEgress({ tool, params: { endpoint: "http://module.dummy-ok.svc.platform.example.org" }, tenantId: "acme" }).ok, false);
  assert.equal(validateEgress({ tool, params: { endpoint: "https://169.254.169.254/latest/meta-data/" }, tenantId: "acme" }).ok, false);
  assert.equal(validateEgress({ tool, params: { endpoint: "https://127.0.0.1/admin" }, tenantId: "acme" }).ok, false);
  assert.equal(validateEgress({ tool, params: { endpoint: "https://localhost/admin" }, tenantId: "acme" }).ok, false);
  assert.equal(validateEgress({ tool, params: { endpoint: "https://10.0.0.5/admin" }, tenantId: "acme" }).ok, false);
  const ok = validateEgress({ tool, params: { endpoint: "https://module.dummy-ok.svc.platform.example.org/v1/upgrade" }, tenantId: "acme" });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});

test("data må ikke flyttes til en anden kunde", () => {
  const withTenant = validateToolCall({ verb: "upgrade.patch", params: { tenantId: "globex" }, tenantId: "acme" });
  assert.equal(withTenant.ok, false);
  assert.ok(withTenant.errors.some((e) => /globex/.test(e.message)));

  const cross = validateToolCall({ verb: "upgrade.patch", params: { crossTenant: true }, tenantId: "acme" });
  assert.equal(cross.ok, false);

  const same = validateToolCall({ verb: "upgrade.patch", params: { tenantId: "acme" }, tenantId: "acme" });
  assert.equal(same.ok, true, JSON.stringify(same.errors));
});

test("et deklareret men ukendt verbum får en konservativ, afgrænset fallback", () => {
  assert.equal(validateToolCall({ verb: "upgrade.hotfix", params: {} }).ok, true);
  assert.equal(validateToolCall({ verb: "upgrade.hotfix", params: { command: "id" } }).ok, false);
  assert.equal(validateToolCall({ verb: "upgrade.hotfix", params: { endpoint: "https://evil.example.net" } }).ok, false, "generisk værktøj har ingen egress");
});

/* --- Runtime-integration ------------------------------------------------- */

function runtimeWith(record = [], m = manifest()) {
  return createAgentRuntime({
    manifest: m,
    pdp,
    auditLog: createMemoryAuditLog(),
    executors: {
      "observe.read": async () => { record.push("observe.read"); return { summary: "read" }; },
      "shell.exec": async () => { record.push("shell.exec"); return { summary: "ran" }; },
    },
    toolBoundary: strictBoundary,
  });
}

test("runtimen afviser et værktøj bundet til det forkerte verbum", async () => {
  const record = [];
  const runtime = runtimeWith(record);
  const result = await runtime.runTask({
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: randomUUID(),
    tenantId: "acme",
    agentRef: baseManifest.metadata.name,
    objective: "tool",
    actions: [{ verb: "observe.read", target: "dummy-ok", environment: "staging", evidence: ["policy-allow"], tool: "upgrade.apply" }],
  });
  assert.equal(result.status, "refused");
  assert.equal(record.length, 0);
});

test("runtimen afviser fri shell, selv når manifestet erklærer det", async () => {
  const record = [];
  const m = manifest();
  m.capabilities.push({ verb: "shell.exec", target: "dummy-ok", autonomyClass: "A0", requiredEvidence: ["policy-allow"] });
  const runtime = runtimeWith(record, m);
  const result = await runtime.runTask({
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: randomUUID(),
    tenantId: "acme",
    agentRef: baseManifest.metadata.name,
    objective: "shell",
    actions: [{ verb: "shell.exec", target: "dummy-ok", environment: "staging", evidence: ["policy-allow"] }],
  });
  assert.equal(result.status, "refused");
  assert.match(result.reason, /værktøj/i);
  assert.equal(record.length, 0);
});

test("runtimen afviser et uautoriseret URL-kald før executor", async () => {
  const record = [];
  const runtime = runtimeWith(record);
  const result = await runtime.runTask({
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: randomUUID(),
    tenantId: "acme",
    agentRef: baseManifest.metadata.name,
    objective: "egress",
    actions: [{ verb: "upgrade.patch", target: "dummy-ok", environment: "staging", evidence: ["policy-allow"], parameters: { endpoint: "https://evil.example.net/collect" } }],
  });
  assert.equal(result.status, "refused");
  assert.match(result.reason, /egress|vært|netværk/i);
  assert.equal(record.length, 0);
});

test("resolveTool kræver at værktøjets verbum matcher", () => {
  const good = resolveTool({ verb: "upgrade.patch", tool: "upgrade.apply" });
  assert.equal(good.ok, true);
  const bad = resolveTool({ verb: "observe.read", tool: "upgrade.apply" });
  assert.equal(bad.ok, false);
});
