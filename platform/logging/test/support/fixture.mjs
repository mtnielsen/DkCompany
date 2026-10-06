/**
 * DKC-049 — fælles testfixture.
 *
 * Testene bruger den rigtige, hash-kædede audit-log (DKC-009, in-memory til
 * enhedstest og SQLite til persistens-testen) og det rigtige filbaserede
 * WORM-lager (DKC-041/048).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditLog } from "../../../modules/audit-service/service/src/store.mjs";
import { createStorageCluster } from "../../../storage/src/object-store.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../../storage/src/tenant-keys.mjs";
import { createLogLedger } from "../../src/ledger.mjs";
import { buildCorrelation } from "../../src/correlation.mjs";
import { buildLogRecord } from "../../src/record.mjs";
import { createWormArchive } from "../../src/archive.mjs";
import { digest } from "../../src/canonical.mjs";

export const POLICY = {
  apiVersion: "contracts.platform/v1alpha1",
  kind: "LoggingPolicy",
  metadata: { name: "test-logging", version: "1.0.0" },
  correlationFields: ["correlationId", "executionId", "tenantId", "resource", "incidentId", "changeId", "traceId"],
  provenance: { classes: ["sensor", "model", "verified", "human", "system"], separated: true },
  retention: { operational: 365, personal: 90, security: 730 },
  archive: {
    minFailureDomains: 3,
    requireImmutableFor: ["personal", "security"],
    targets: [
      { id: "primary", kind: "primary", failureDomain: "fsn1", immutable: false, dataClasses: ["operational", "personal", "security"], classification: "object-store" },
      { id: "worm-external", kind: "external", failureDomain: "hel1", immutable: true, dataClasses: ["operational", "personal", "security"], classification: "object-store" },
      { id: "worm-offline", kind: "offline", failureDomain: "ash1", immutable: true, dataClasses: ["personal", "security"], classification: "object-store" },
    ],
  },
  access: { defaultDeny: true, readerRoles: ["auditor", "security-owner", "platform-admin"], auditAccess: true, retentionBypassRoles: ["platform-owner"] },
  timeSync: { maxSkewSeconds: 300, monotonicSequences: true },
  redaction: { forbiddenReasoningKeys: ["chainOfThought", "reasoning", "internalThoughts", "scratchpad"], personalDataPolicy: "minimize-and-digest" },
};

export const PRINCIPAL = { id: "oidc|auditor@example.org", tenantId: "acme", roles: ["auditor"], kind: "human" };
export const APPROVER = { id: "oidc|anna.andersen", tenantId: "acme", roles: ["platform-approver"], kind: "human" };

export function makeAuditLog() {
  return createAuditLog();
}

export function makeLedger(audit = makeAuditLog()) {
  return { ledger: createLogLedger({ audit, clock: () => Date.now() }), audit };
}

export function makeCorrelation(overrides = {}) {
  return buildCorrelation({ correlationId: "corr-test-1", executionId: "exec-test-1", changeId: "res://acme/change/CHG-1", ...overrides });
}

export function tempRoot(prefix = "dkc-049-test-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function mirrorCluster(root) {
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

export function makeArchive(baseDir) {
  const primary = mirrorCluster(join(baseDir, "mirror-primary"));
  const external = mirrorCluster(join(baseDir, "mirror-external"));
  const offline = mirrorCluster(join(baseDir, "mirror-offline"));
  const mirrors = [
    { id: "primary", kind: "primary", failureDomain: "fsn1", store: primary, classification: "object-store", immutable: false, dataClasses: ["operational", "personal", "security"] },
    { id: "worm-external", kind: "external", failureDomain: "hel1", store: external, classification: "object-store", immutable: true, dataClasses: ["operational", "personal", "security"] },
    { id: "worm-offline", kind: "offline", failureDomain: "ash1", store: offline, classification: "object-store", immutable: true, dataClasses: ["personal", "security"] },
  ];
  return { archive: createWormArchive({ mirrors, policy: POLICY }), mirrors, clusters: { primary, external, offline } };
}

export function sensorRecord({ correlation = makeCorrelation(), service = "observability", resource = "res://acme/service/checkout-api", value = { metric: 1 } } = {}) {
  return buildLogRecord(
    {
      correlation,
      scope: { tenantId: "acme", environment: "dev", service, resource },
      provenance: "sensor",
      observation: { source: "otel-collector", freshness: "fresh", value },
      dataClassification: "operational",
      retentionClass: "operational",
    },
    { policy: POLICY }
  );
}

export function humanRecord({ correlation = makeCorrelation(), decision = "approve", subject = APPROVER.id } = {}) {
  return buildLogRecord(
    {
      correlation,
      scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://acme/deployment/checkout-api" },
      provenance: "human",
      human: { subject, name: "Anna Andersen", role: "platform-approver", decision, decidedAt: new Date().toISOString() },
      dataClassification: "operational",
      retentionClass: "operational",
    },
    { policy: POLICY }
  );
}

export function modelRecord({ correlation = makeCorrelation(), approvalDigest = null, mutating = true, retentionClass = "operational", tool = { name: "kubectl.scale", verb: "scale", target: "res://acme/deployment/checkout-api" } } = {}) {
  return buildLogRecord(
    {
      correlation,
      scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://acme/deployment/checkout-api" },
      provenance: "model",
      model: { provider: "platform-gateway", name: "ops-copilot", promptVersion: "prompt-17", decisionSummary: "Skaler checkout-api." },
      action: {
        mutating,
        tool,
        ...(approvalDigest ? { approvalDigest } : {}),
        before: { replicas: 2 },
        after: { replicas: 4 },
        retry: 0,
        fallback: null,
      },
      ...(mutating ? { receipt: { intentId: "planned-intent", idempotencyId: "idem-test", state: "pending", auditEventId: null, anchored: false } } : {}),
      dataClassification: "operational",
      retentionClass,
    },
    { policy: POLICY }
  );
}

export const artifactDigest = () => digest({ deployed: "checkout-api@test" });
