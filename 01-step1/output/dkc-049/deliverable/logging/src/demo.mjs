/**
 * DKC-049 — deterministisk gennemløb på den rigtige stak.
 *
 * Demonstrationen bruger den rigtige SQLite-baserede audit-ledger (DKC-009) og
 * det rigtige filbaserede WORM-lager (DKC-041/048). Den viser:
 *
 *   - et tværserverforløb der rekonstrueres til samme artefakt og godkendelse,
 *   - at et logsvigt ikke giver en ulogget mutation (fail-closed),
 *   - at en WORM-låst logpost ikke kan slettes,
 *   - at ledgerens hash-kæde og monotone sekvenser verificeres.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAuditWriter } from "../../persistence/src/audit-roles.mjs";
import { createStorageCluster } from "../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../storage/src/tenant-keys.mjs";
import { buildCorrelation } from "./correlation.mjs";
import { buildLogRecord, approvalDigestOf } from "./record.mjs";
import { createLogLedger } from "./ledger.mjs";
import { createWormArchive, archiveKey } from "./archive.mjs";
import { createMutationRecorder } from "./receipt.mjs";
import { reconstructFlow } from "./reconstruct.mjs";
import { loadLoggingPolicy } from "./policy.mjs";
import { digest } from "./canonical.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";

function mirrorCluster(root) {
  const plan = {
    topology: {
      hosts: [
        { id: "storage-1", failureDomain: "dc-1" },
        { id: "storage-2", failureDomain: "dc-2" },
        { id: "storage-3", failureDomain: "dc-3" },
      ],
      readQuorum: 1,
      writeQuorum: 1,
      replicaFactor: 1,
    },
    dataClasses: [{ id: "object-store" }, { id: "authoritative" }],
  };
  return createStorageCluster({ plan, rootDir: root, keyRing: createTenantKeyRing(deriveTestKeyRing()) });
}

export async function runDemo() {
  const root = mkdtempSync(join(tmpdir(), "dkc-049-demo-"));
  const dataDir = join(root, "audit");
  const policy = loadLoggingPolicy(repoRoot);
  const writer = openAuditWriter({ dataDir });
  const clusterA = mirrorCluster(join(root, "mirror-primary"));
  const clusterB = mirrorCluster(join(root, "mirror-worm-external"));
  const clusterC = mirrorCluster(join(root, "mirror-worm-offline"));
  const mirrors = [
    { id: "primary", kind: "primary", failureDomain: "fsn1", store: clusterA, classification: "object-store", immutable: false, dataClasses: ["operational", "personal", "security"] },
    { id: "worm-external", kind: "external", failureDomain: "hel1", store: clusterB, classification: "object-store", immutable: true, dataClasses: ["operational", "personal", "security"] },
    { id: "worm-offline", kind: "offline", failureDomain: "ash1", store: clusterC, classification: "object-store", immutable: true, dataClasses: ["operational", "personal", "security"] },
  ];

  const ledger = createLogLedger({ audit: writer.log });
  const archive = createWormArchive({ mirrors, policy });
  const recorder = createMutationRecorder({ ledger, journal: writer.journal, archive, policy });

  const now = Date.now();
  const iso = (offset = 0) => new Date(now + offset).toISOString();
  const correlation = buildCorrelation({ correlationId: "corr-demo-0001", executionId: "exec-demo-0001", changeId: "res://acme/change/CHG-1" });
  const artifactDigest = digest({ deployed: "checkout-api@2026.09.16" });

  // 1) Sensorobservation (server: observability).
  await ledger.append(buildLogRecord({
    occurredAt: iso(0),
    correlation,
    scope: { tenantId: "acme", environment: "dev", service: "observability", resource: "res://acme/service/checkout-api" },
    provenance: "sensor",
    observation: { source: "otel-collector", freshness: "fresh", value: { digest: artifactDigest, latencyP95Ms: 120 } },
    dataClassification: "operational",
    retentionClass: "operational",
  }, { policy }));

  // 2) Menneskelig godkendelse (server: runtime).
  const human = buildLogRecord({
    occurredAt: iso(100),
    correlation,
    scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://acme/deployment/checkout-api" },
    provenance: "human",
    human: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "platform-approver", decision: "approve", decidedAt: iso(100) },
    dataClassification: "operational",
    retentionClass: "operational",
  }, { policy });
  await ledger.append(human);
  const approvalDigest = approvalDigestOf(human);

  // 3) Modeludsagn der foreslår og udfører en muterende handling.
  await ledger.append(buildLogRecord({
    occurredAt: iso(200),
    correlation,
    scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://acme/deployment/checkout-api" },
    provenance: "model",
    model: { provider: "platform-gateway", name: "ops-copilot", promptVersion: "prompt-17", responseDigest: artifactDigest, decisionSummary: "Skaler checkout-api til fire replikaer." },
    action: {
      mutating: true,
      tool: { name: "kubectl.scale", verb: "scale", target: "res://acme/deployment/checkout-api", parameters: { replicas: 4 } },
      approvalDigest,
      before: { replicas: 2 },
      after: { replicas: 4 },
      retry: 0,
      fallback: null,
    },
    receipt: { intentId: "planned-intent", idempotencyId: "idem-demo-0001", state: "pending", auditEventId: null, anchored: false },
    dataClassification: "personal",
    retentionClass: "personal",
  }, { policy }));

  // 4) Den faktiske mutation med holdbar kvittering FØR mutationen.
  let mutated = false;
  const recorded = await recorder.recordMutation({
    tenantId: "acme",
    idempotencyId: "idem-demo-0001",
    verb: "scale",
    target: "res://acme/deployment/checkout-api",
    correlation,
    resource: "res://acme/deployment/checkout-api",
    service: "runtime",
    environment: "dev",
    request: { replicas: 4 },
    retentionClass: "personal",
    dataClassification: "personal",
    tool: { name: "kubectl.scale", verb: "scale", target: "res://acme/deployment/checkout-api", parameters: { replicas: 4 } },
    approvalDigest,
    before: { replicas: 2 },
    after: { replicas: 4 },
    artifactDigest,
    mutation: async () => {
      mutated = true;
      return { replicas: 4 };
    },
  });

  const all = await ledger.read({ tenantId: "acme" });
  const reconstruction = reconstructFlow(all, { correlationId: "corr-demo-0001", requireServers: 2 });
  const chain = await ledger.verify("acme");
  const archiveCheck = await archive.verify(recorded.intent);

  // 5) WORM-nægtelse: den immutable kopi kan ikke slettes.
  const key = archiveKey(recorded.intent);
  const externalTarget = recorded.archive?.targets?.find((t) => t.id === "worm-external") ?? null;
  const deleteAttempt = externalTarget ? clusterB.deleteVersion("acme", key, externalTarget.version) : { deleted: false, reason: "no-target" };

  // 6) Fail-closed: et logsvigt må ikke give en mutation.
  let mutatedOnJournalFailure = false;
  try {
    await createMutationRecorder({
      ledger,
      journal: { begin: async () => { throw new Error("audit utilgængelig"); }, complete: async () => ({}) },
      policy,
    }).recordMutation({
      tenantId: "acme", idempotencyId: "idem-fail-journal", verb: "scale", target: "res://acme/deployment/checkout-api",
      correlation, retentionClass: "operational", mutation: async () => { mutatedOnJournalFailure = true; },
    });
  } catch { /* forventet */ }

  let mutatedOnLedgerFailure = false;
  try {
    await createMutationRecorder({
      ledger: { append: async () => { throw new Error("log utilgængelig"); } },
      journal: writer.journal,
      policy,
    }).recordMutation({
      tenantId: "acme", idempotencyId: "idem-fail-ledger", verb: "scale", target: "res://acme/deployment/checkout-api",
      correlation, retentionClass: "operational", mutation: async () => { mutatedOnLedgerFailure = true; },
    });
  } catch { /* forventet */ }

  writer.close();
  rmSync(root, { recursive: true, force: true });

  console.log(`✔ tværserverforløb: ${reconstruction.servers.join(" + ")}`);
  console.log(`✔ rekonstruktion komplet: ${reconstruction.complete} (artefakter: ${Object.keys(reconstruction.artifacts).length}, godkendelser: ${reconstruction.approvals.length})`);
  console.log(`✔ ledger-hash-kæde: ${chain.ok ? "intakt" : "BRUDT"} (${chain.records} poster, ${chain.streams} strømme)`);
  console.log(`✔ WORM-arkiv verificeret: ${archiveCheck.ok} (${archiveCheck.targets.filter((t) => t.locked).length} låste kopier)`);
  console.log(`✔ WORM-sletning afvist: ${deleteAttempt.deleted === false} (${deleteAttempt.reason})`);
  console.log(`✔ mutation udført efter holdbar kvittering: ${mutated && recorded.receipt?.ok === true}`);
  console.log(`✔ fail-closed ved journalfejl: ${mutatedOnJournalFailure === false}`);
  console.log(`✔ fail-closed ved logfejl: ${mutatedOnLedgerFailure === false}`);

  const ok = reconstruction.complete && chain.ok && archiveCheck.ok && deleteAttempt.deleted === false && mutated && !mutatedOnJournalFailure && !mutatedOnLedgerFailure;
  if (!ok) {
    console.error("✘ demonstrationen fejlede");
    process.exit(1);
  }
}
