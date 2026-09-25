import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createAgentRuntime } from "../src/runtime.mjs";
import { createMemoryAuditLog } from "../src/clients.mjs";
import { evidenceFixture } from "./evidence-fixtures.mjs";
import { validPdp } from "./pdp-fixtures.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));
const EVIDENCE = evidenceFixture(["tests-pass"]);

const task = (tenantId, actions) => ({ apiVersion: "contracts.platform/v1alpha1", kind: "AgentTask", taskId: randomUUID(), tenantId, agentRef: manifest.metadata.name, objective: "test", evidenceIndex: EVIDENCE.index, actions });
const allowPdp = validPdp({ requiredEvidence: ["policy-allow"] });

function runtime(record, options = {}) {
  return createAgentRuntime({
    manifest,
    pdp: allowPdp,
    auditLog: createMemoryAuditLog(),
    executors: { "upgrade.dry-run": async () => { record.push("upgrade.dry-run"); return { summary: "clean" }; } },
    ...options,
  });
}

test("baggrundsopgave der peger på en anden kunde afvises", async () => {
  const record = [];
  const rt = runtime(record, { tenantId: "acme" });
  const result = await rt.runTask(task("globex", [{ verb: "upgrade.dry-run", target: "dummy-ok", environment: "staging", evidence: ["policy-allow", "tests-pass"] }]));
  assert.equal(result.status, "refused");
  assert.equal(result.tenantId, "globex");
  assert.match(result.reason, /matcher ikke/);
  assert.equal(record.length, 0, "der må ikke udføres handlinger for en fremmed kunde");
});

test("opgave for agentens egen kunde udføres og audit bærer tenanten", async () => {
  const record = [];
  const auditLog = createMemoryAuditLog();
  const rt = createAgentRuntime({
    manifest,
    pdp: allowPdp,
    auditLog,
    executors: { "upgrade.dry-run": async () => { record.push("upgrade.dry-run"); return { summary: "clean" }; } },
    tenantId: "acme",
  });
  const result = await rt.runTask(task("acme", [{ verb: "upgrade.dry-run", target: "dummy-ok", environment: "staging", evidence: ["policy-allow", "tests-pass"] }]));
  assert.equal(result.status, "completed");
  assert.equal(result.tenantId, "acme");
  assert.ok(auditLog.events.length >= 3);
  assert.ok(auditLog.events.every((e) => e.tenantId === "acme"), "alle audit-events skal være bundet til kunden");
});
