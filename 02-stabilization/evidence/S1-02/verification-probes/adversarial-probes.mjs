import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? process.cwd());
const load = (path) => import(pathToFileURL(resolve(root, path)).href);

const [
  { createAgentRuntime },
  { createMemoryAuditLog },
  { evidenceFixture },
  { validDecision },
  { createProtectedDataGuard, loadPolicy },
  { createAuditLog },
  { createLogLedger },
  { createRuntimeLogObserver },
  { loadLoggingPolicy },
] = await Promise.all([
  load("platform/runtime/src/runtime.mjs"),
  load("platform/runtime/src/clients.mjs"),
  load("platform/runtime/test/evidence-fixtures.mjs"),
  load("platform/runtime/test/pdp-fixtures.mjs"),
  load("platform/data-protection/src/registry.mjs"),
  load("platform/modules/audit-service/service/src/store.mjs"),
  load("platform/logging/src/ledger.mjs"),
  load("platform/logging/src/hooks.mjs"),
  load("platform/logging/src/policy.mjs"),
]);

const manifest = JSON.parse(readFileSync(resolve(root, "platform/modules/dummy-ok/agents/backup-agent.json"), "utf8"));
const evidence = evidenceFixture(["tests-pass", "dry-run-clean", "rollback-tested"]);
const policy = loadPolicy();
const task = (tenantId, target) => ({
  apiVersion: "contracts.platform/v1alpha1",
  kind: "AgentTask",
  taskId: randomUUID(),
  tenantId,
  agentRef: manifest.metadata.name,
  objective: "isolated verifier probe",
  evidenceIndex: evidence.index,
  actions: [{ verb: "observe.read", target, environment: "staging" }],
});

function evaluateGuard(probe, records, target, extra = {}, principal = { kind: "agent", id: "probe", tenantId: "contoso" }) {
  const guard = createProtectedDataGuard({ register: { records }, policy });
  return {
    probe,
    result: guard.evaluate({ principal, operation: "read", target, ...extra }),
  };
}

async function evaluateRuntime(probe, protectedData, taskInput) {
  let executorCalls = 0;
  const auditLog = createMemoryAuditLog();
  const runtime = createAgentRuntime({
    manifest,
    pdp: { decide: async (input) => validDecision(input, { requiredEvidence: ["policy-allow"] }) },
    auditLog,
    protectedData,
    executors: {
      "observe.read": async () => {
        executorCalls += 1;
        return { summary: "ordinary data" };
      },
    },
  });
  const result = await runtime.runTask(taskInput);
  return { probe, status: result.status, executorCalls, reason: result.reason };
}

const acmeOrdinary = {
  id: "acme-secret",
  dataClass: "ordinary",
  noAiAccess: false,
  authoritativePointer: "acme/private",
  tenantId: "acme",
};
const guardResults = [
  evaluateGuard("foreign_acme_ordinary_with_principal_and_option", [acmeOrdinary], "acme/private", { tenantId: "contoso" }),
  evaluateGuard("foreign_acme_ordinary_with_adapter", [acmeOrdinary], "acme/private", { tenantId: "contoso", adapter: "app" }),
  evaluateGuard("conflicting_tenant_hint", [acmeOrdinary], "acme/private", { tenantId: "acme" }),
  evaluateGuard(
    "missing_principal_tenant",
    [acmeOrdinary],
    "acme/private",
    { tenantId: "acme" },
    { kind: "agent", id: "probe" },
  ),
  evaluateGuard("substring_target", [{ id: "ordinary", dataClass: "ordinary", noAiAccess: false }], "ordinary-shadow"),
  evaluateGuard("unknown_class", [{ id: "weird", dataClass: "custom-unknown", noAiAccess: false }], "weird"),
  evaluateGuard("malformed_noai", [{ id: "malformed", dataClass: "ordinary", noAiAccess: null }], "malformed"),
  evaluateGuard("unknown_target", [{ id: "ordinary", dataClass: "ordinary", noAiAccess: false }], "missing"),
];

const defaultGuard = createProtectedDataGuard();
guardResults.push({
  probe: "caller_record_override_on_policy_bundle",
  result: defaultGuard.evaluate({
    principal: { kind: "agent", id: "probe", tenantId: "contoso" },
    operation: "delete",
    target: "policy-bundle",
    record: { id: "fake", dataClass: "ordinary", noAiAccess: false },
  }),
});
guardResults.push({
  probe: "positive_tenant_ordinary",
  result: createProtectedDataGuard({ register: { records: [acmeOrdinary] }, policy }).evaluate({
    principal: { kind: "agent", id: "probe", tenantId: "acme" },
    operation: "read",
    target: "acme/private",
    tenantId: "acme",
  }),
});

const appendGuard = createProtectedDataGuard({
  register: { records: [{ id: "append-resource", dataClass: "append-only", noAiAccess: false, tenantId: "acme" }] },
  policy,
});
guardResults.push({
  probe: "positive_append_only_append_adapter",
  result: appendGuard.evaluate({
    principal: { kind: "agent", id: "probe", tenantId: "acme" },
    operation: "append",
    target: "append-resource",
    adapter: "app",
  }),
});
guardResults.push({
  probe: "append_only_update_adapter",
  result: appendGuard.evaluate({
    principal: { kind: "agent", id: "probe", tenantId: "acme" },
    operation: "update",
    target: "append-resource",
    adapter: "app",
  }),
});

const unknownClassService = {
  policy,
  classify: async () => ({
    status: "classified",
    record: { id: "dummy-ok", dataClass: "custom-unknown", noAiAccess: false, tenantId: "acme" },
  }),
};
const foreignTenantService = {
  policy,
  classify: async () => ({
    status: "classified",
    record: { id: "dummy-ok", dataClass: "ordinary", noAiAccess: false, tenantId: "acme" },
  }),
};
const substringGuard = createProtectedDataGuard({
  register: { records: [{ id: "ok", dataClass: "ordinary", noAiAccess: false }] },
  policy,
});

const runtimeResults = [
  await evaluateRuntime("runtime_unknown_class", unknownClassService, task("acme", "dummy-ok")),
  await evaluateRuntime("runtime_foreign_tenant", foreignTenantService, task("contoso", "dummy-ok")),
  await evaluateRuntime("runtime_substring_target", substringGuard, task("acme", "dummy-ok")),
];

const audit = createAuditLog();
const ledger = createLogLedger({ audit });
const observer = createRuntimeLogObserver({
  ledger,
  policy: loadLoggingPolicy(resolve(root, "platform")),
});
await observer({
  phase: "action.decision",
  tenantId: "acme",
  agentRef: "probe",
  target: "policy-bundle",
  summary: "S1_02_SECRET_CANARY",
});
const protectedRows = await ledger.read({ tenantId: "acme" });

const ordinaryGuard = createProtectedDataGuard({
  register: {
    records: [{
      id: "ordinary-resource",
      dataClass: "ordinary",
      noAiAccess: false,
      authoritativePointer: "ordinary-resource",
      tenantId: "acme",
    }],
  },
  policy,
});
const ordinaryAudit = createAuditLog();
const ordinaryLedger = createLogLedger({ audit: ordinaryAudit });
const ordinaryObserver = createRuntimeLogObserver({
  ledger: ordinaryLedger,
  policy: loadLoggingPolicy(resolve(root, "platform")),
  protectedData: ordinaryGuard,
});
await ordinaryObserver({
  phase: "action.decision",
  tenantId: "acme",
  agentRef: "probe",
  target: "ordinary-resource",
  summary: "ordinary-positive-summary",
});
const ordinaryRows = await ordinaryLedger.read({ tenantId: "acme" });

console.log(JSON.stringify([
  ...guardResults,
  ...runtimeResults,
  {
    probe: "protected_logger",
    canaryPersisted: JSON.stringify(protectedRows).includes("S1_02_SECRET_CANARY"),
    value: protectedRows[0]?.observation?.value,
  },
  {
    probe: "ordinary_logger_positive",
    summaryPersisted: JSON.stringify(ordinaryRows).includes("ordinary-positive-summary"),
  },
], null, 2));
