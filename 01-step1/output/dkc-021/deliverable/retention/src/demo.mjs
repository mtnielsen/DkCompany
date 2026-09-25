/**
 * DKC-021 — deterministisk gennemløb af sletning på den rigtige stak.
 *
 * Demoen bygger den faktiske lagerklynge, cache, indeks, afledte AI-lager og
 * suppressionsjournal og gennemfører en sletning for et syntetisk subjekt.
 * Bruges af `retention-check` og `retention-demo`; den er ikke et driftsbevis
 * mod et levende miljø.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageCluster } from "../../storage/src/object-store.mjs";
import { createEphemeralCache } from "../../storage/src/cache.mjs";
import { createRebuildableIndex } from "../../storage/src/index.mjs";
import { createTenantKeyRing, deriveTestKeyRing } from "../../storage/src/tenant-keys.mjs";
import { loadStoragePlan } from "../../storage/src/plan.mjs";
import { createSuppressionLedger } from "../../backup/src/suppression.mjs";
import { createDerivedAiStore } from "./derived-ai.mjs";
import { createMemoryRetentionStore, subjectDigestOf } from "./holds.mjs";
import { createMemoryAuditTrail, subjectDigest } from "./audit.mjs";
import { buildSurfaces } from "./surfaces.mjs";
import { createDeletionService } from "./deletion-service.mjs";
import { createRestoreReleaseGate, createQuarantineWorkspace } from "./restore-gate.mjs";
import { loadPolicy, repoRoot } from "./registry.mjs";

const SUBJECT_KEY = "kunde@example.org";
const TENANT = "acme";

export function runDemo({ policy = loadPolicy() } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), "dkc-021-demo-"));
  const cleanup = () => rmSync(rootDir, { recursive: true, force: true });
  try {
    const cluster = createStorageCluster({ plan: loadStoragePlan(repoRoot), rootDir: join(rootDir, "store"), keyRing: createTenantKeyRing(deriveTestKeyRing()) });
    const cache = createEphemeralCache({ rootDir: join(rootDir, "cache") });
    const index = createRebuildableIndex({ store: cluster, rootDir: join(rootDir, "index") });
    const derivedAi = createDerivedAiStore({ rootDir: join(rootDir, "derived-ai") });
    const ledger = createSuppressionLedger({ path: join(rootDir, "suppression.ndjson") });

    const digest = subjectDigest(SUBJECT_KEY);
    const surfaces = buildSurfaces({ policy, cluster, index, cache, derivedAi, ledger, upstreamProvider: null });
    const primary = surfaces.find((s) => s.kind === "primary");

    // Syntetiske data på hver flade.
    const objectKey = "docs/kunde.json";
    cluster.put(TENANT, objectKey, Buffer.from(JSON.stringify({ email: SUBJECT_KEY, note: "syntetisk" })));
    primary.recordSubject(TENANT, digest, objectKey);
    cache.set(TENANT, `subject:${digest}`, { email: SUBJECT_KEY });
    derivedAi.put(TENANT, digest, "embedding-v1", { vector: [0.1, 0.2, 0.3] });
    index.build(TENANT);

    const store = createMemoryRetentionStore();
    const audit = createMemoryAuditTrail();
    const service = createDeletionService({ policy, store, surfaces, audit });
    const principal = { id: "oidc|pia.privat", name: "Pia Privat", tenantId: TENANT, roles: ["privacy-officer", "data-protection-officer"], kind: "human" };

    const receipt = service.requestDeletion({ principal, tenantId: TENANT, subjectKey: SUBJECT_KEY });

    // Bevis at det slettede ikke kan læses igen på primærfladen.
    const objectGone = cluster.versions(TENANT, objectKey).length === 0;

    // Restore-gate: karantæne indeholder en gammel kopi af subjektet.
    const workspace = createQuarantineWorkspace();
    workspace.add(TENANT, digest, objectKey, { email: SUBJECT_KEY });
    const gate = createRestoreReleaseGate({ store });
    const opened = gate.openGate({ tenantId: TENANT, restorePointIso: new Date(Date.now() - 60_000).toISOString(), ledger });
    const openedQuarantined = opened.status === "quarantined";
    const applied = gate.applyDecisions({ tenantId: TENANT, gateId: opened.gateId, ledger, workspace });
    const released = gate.release({ tenantId: TENANT, gateId: opened.gateId, ledger, workspace, releasedBy: "oidc|operator" });

    // Hold blokerer sletning.
    const held = service.placeHold({
      principal,
      tenantId: TENANT,
      subjectKey: SUBJECT_KEY,
      reason: "verserende retssag kræver bevaring",
      approvedBy: { subject: "oidc|legal.counsel", name: "Lars Lov", role: "legal-counsel" },
    });
    const blocked = service.requestDeletion({ principal, tenantId: TENANT, subjectKey: SUBJECT_KEY });

    return {
      rootDir,
      cleanup,
      policy,
      digest,
      receipt,
      holds: { held, blocked },
      restore: { opened: openedQuarantined, applied, released, workspace },
      audit: { intents: audit.intents(), outcomes: audit.outcomes() },
      objectGone,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export { SUBJECT_KEY, TENANT, subjectDigestOf, subjectDigest };
