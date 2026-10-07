/**
 * DKC-059 — cutover, afstemning og rollback for providerskift.
 *
 * En cutover må kun gennemføres når preflight'en er tilladt (alle obligatoriske
 * capabilities findes, ingen sikkerhedskritisk semantik nedgraderes, og
 * kompatibilitetsrækken er planlagt), når en menneskelig godkendelse af både
 * indhold og adgangsrettigheder foreligger, og når et snapshot er taget **før**
 * cutover. Efter cutover sættes den gamle provider read-only, og dens aktive
 * credentials tilbagekaldes, mens evidensen bevares.
 *
 * Afstemningen opgør:
 *   - antal (kilde mod mål),
 *   - checksums over den projektion der skal være invariant under id-mapping,
 *   - links (hver relation peger på en kendt stabil reference),
 *   - autorisation (ACL bevares 1:1), og
 *   - referencespor (hver stabil reference er sporet til sit mål).
 *
 * Ved et IAM-skift kontrolleres desuden at entydig menneskelig/agentidentitet
 * og historisk audit-provenance bevares.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestOf } from "../../runtime/src/digest.mjs";
import { migrationApprovalProblems } from "./model.mjs";
import { preflightSwap } from "./provider-negotiate.mjs";
import { assertProviderSwapAccess } from "./provider-permissions.mjs";

export class ProviderSwapError extends Error {
  constructor(message, code = "provider_swap_error", status = 409) {
    super(message);
    this.name = "ProviderSwapError";
    this.code = code;
    this.status = status;
  }
}

/** Deterministisk mål-id udledt af tenant, klasse, kilde/mål og kilde-id. */
export function targetIdFor({ tenantId, classId, from, to, sourceId }) {
  return `map:${digestOf({ tenantId, classId, from, to, sourceId }).slice(0, 24)}`;
}

/** Den projektion der skal være invariant under id-mapping. */
export function projectionOf(record) {
  return {
    reference: record.reference,
    entityType: record.entityType,
    owner: record.owner,
    classification: record.classification,
    acl: record.acl,
    links: [...(record.links ?? [])].map((l) => `${l.rel}:${l.reference}`).sort(),
    identity: record.identity ?? null,
    auditProvenance: [...(record.auditProvenance ?? [])].sort(),
    data: record.data ?? {},
  };
}

function checksumOf(records) {
  return digestOf(records.map(projectionOf).sort((a, b) => a.reference.localeCompare(b.reference)));
}

/** Map et kildeobjekt til et målobjekt uden at skrive. */
export function mapProviderRecord({ fixture, record }) {
  if (record.owner?.tenantId !== fixture.tenantId) {
    throw new ProviderSwapError(`posten '${record.sourceId}' tilhører en anden tenant`, "cross_tenant_record");
  }
  const reference = record.references?.[0];
  if (!reference) throw new ProviderSwapError(`posten '${record.sourceId}' mangler en stabil reference`, "missing_reference");
  const targetId = targetIdFor({ tenantId: fixture.tenantId, classId: fixture.class, from: fixture.from, to: fixture.to, sourceId: record.sourceId });
  return {
    targetId,
    reference,
    tenantId: fixture.tenantId,
    appId: fixture.appId,
    class: fixture.class,
    provider: fixture.to,
    entityType: record.entityType,
    sourceObjectId: String(record.sourceId),
    owner: record.owner,
    classification: record.classification,
    acl: record.acl ?? { readSubjects: [], readGroups: [] },
    links: [...(record.links ?? [])].map((l) => ({ rel: l.rel, reference: l.reference })),
    identity: record.identity ?? null,
    auditProvenance: [...(record.auditProvenance ?? [])],
    data: record.data ?? {},
  };
}

function preflightFor({ providers, catalog, matrix, policy, fixture }) {
  return preflightSwap({
    providers,
    catalog,
    matrix,
    policy,
    from: fixture.from,
    to: fixture.to,
    connectionString: providers.providers.find((p) => p.id === fixture.to)?.connection?.endpoint ?? null,
  });
}

function assertApproval({ approval, operatorSubject, fixture }) {
  if (!approval) throw new ProviderSwapError("cutover kræver en menneskelig godkendelse af indhold og adgangsrettigheder", "approval_required", 403);
  const problems = migrationApprovalProblems(approval, { operatorSubject, tenantId: fixture.tenantId, appId: fixture.appId });
  if (problems.length) throw new ProviderSwapError(problems[0].message, "invalid_approval", 403);
}

/**
 * Kør et providerskift deterministisk mod den filbaserede butik. Skriver
 * poster, id-mapping, referencespor, read-only-tilstand, credentialrevokation
 * og en kvittering. Returnerer kvitteringen og afstemningen.
 */
export function executeSwap({ store, fixture, providers, catalog, matrix, policy, principal, approval = null, operatorSubject = null, at = "2026-03-01T00:00:00Z", snapshotDir = null, requireApproval = null } = {}) {
  assertProviderSwapAccess({ principal, tenantId: fixture.tenantId, action: "cutover" });

  const preflight = preflightFor({ providers, catalog, matrix, policy, fixture });
  if (!preflight.allowed) {
    throw new ProviderSwapError(`preflight blokerede skiftet: ${preflight.problems[0]?.message ?? "ukendt årsag"}`, "preflight_blocked", 409);
  }
  if (preflight.mode === "planned-migration" && !(fixture.migrationProof ?? "").trim()) {
    throw new ProviderSwapError("en planlagt migration kræver et migrationsbevis", "migration_proof_required");
  }
  const needsApproval = requireApproval === null ? preflight.cutover.requiresHumanApproval : requireApproval;
  if (needsApproval) assertApproval({ approval, operatorSubject, fixture });

  const created = snapshotDir === null;
  const dir = snapshotDir ?? mkdtempSync(join(tmpdir(), "dkc059-swap-"));
  try {
    store.snapshot(dir);
    const epochBefore = store.epoch();

    const mapped = [];
    for (const record of fixture.records ?? []) {
      const target = mapProviderRecord({ fixture, record });
      store.upsertRecord(fixture.to, target, { at });
      store.saveMapping({
        tenantId: fixture.tenantId,
        sourceId: String(record.sourceId),
        from: fixture.from,
        to: fixture.to,
        targetId: target.targetId,
        reference: target.reference,
        at,
      });
      mapped.push(target);
    }

    const stored = store.listRecords({ provider: fixture.to, tenantId: fixture.tenantId });
    const sourceChecksum = checksumOf(mapped);
    const targetChecksum = checksumOf(stored);

    // Afstemning: antal, checksums, links, autorisation og referencespor.
    const linkProblems = [];
    for (const record of stored) {
      for (const link of record.links ?? []) {
        if (!store.getReferenceTrace(link.reference)) linkProblems.push(`${record.reference} -> ${link.reference}`);
      }
    }
    const aclProblems = stored.filter((record) => digestOf(record.acl) !== digestOf(mapped.find((m) => m.targetId === record.targetId)?.acl)).map((r) => r.reference);
    const referenceProblems = mapped.filter((m) => store.getReferenceTrace(m.reference)?.targetId !== m.targetId).map((m) => m.reference);

    // IAM: entydig identitet og historisk audit-provenance.
    const identitySubjects = new Set();
    const identityProblems = [];
    const auditProblems = [];
    for (const record of stored) {
      if (!record.identity) continue;
      if (identitySubjects.has(record.identity.subject)) identityProblems.push(`dubleret identitet '${record.identity.subject}'`);
      identitySubjects.add(record.identity.subject);
      const original = mapped.find((m) => m.targetId === record.targetId);
      if (original?.identity && (original.identity.kind !== record.identity.kind || original.identity.subject !== record.identity.subject)) {
        identityProblems.push(`identiteten for '${record.reference}' ændrede sig`);
      }
      const missingAudit = (original?.auditProvenance ?? []).filter((entry) => !(record.auditProvenance ?? []).includes(entry));
      if (missingAudit.length) auditProblems.push(`${record.reference}: ${missingAudit.join(", ")}`);
    }

    const counts = {
      source: fixture.records.length,
      mapped: mapped.length,
      created: stored.length,
      failed: fixture.records.length - mapped.length,
    };
    const reconciliation = {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "ProviderReconciliation",
      swapId: fixture.id,
      from: fixture.from,
      to: fixture.to,
      class: fixture.class,
      tenantId: fixture.tenantId,
      at,
      counts,
      checksums: { algorithm: "sha256", source: sourceChecksum, target: targetChecksum, match: sourceChecksum === targetChecksum },
      links: { preserved: linkProblems.length === 0, problems: linkProblems },
      authorization: { preserved: aclProblems.length === 0, problems: aclProblems },
      references: { preserved: referenceProblems.length === 0, problems: referenceProblems },
      identity: { preserved: identityProblems.length === 0, problems: identityProblems },
      auditProvenance: { preserved: auditProblems.length === 0, problems: auditProblems },
      functionalityLoss: fixture.functionalityLoss ?? [],
    };

    const readOnly = preflight.cutover.oldProviderReadOnly !== false;
    if (readOnly) store.setProviderReadOnly(fixture.from, { at, reason: "cutover" });

    let revocation = { revoked: [], evidenceRetained: true, active: [] };
    if (preflight.cutover.revokeCredentials !== false) {
      const active = store.listCredentials({ provider: fixture.from, tenantId: fixture.tenantId, active: true });
      const revoked = active.map((cred) => store.revokeCredential(cred.id, { at, reason: "provider-offboarding" }));
      revocation = {
        revoked: revoked.map((c) => c.id),
        evidenceRetained: true,
        active: store.listCredentials({ provider: fixture.from, tenantId: fixture.tenantId, active: true }).map((c) => c.id),
      };
    }

    const receipt = {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "ProviderSwapReceipt",
      swapId: fixture.id,
      from: fixture.from,
      to: fixture.to,
      class: fixture.class,
      tenantId: fixture.tenantId,
      appId: fixture.appId,
      mode: preflight.mode,
      at,
      status: "cutover",
      epochBefore,
      epochAfter: store.epoch(),
      approvalRef: approval ? `${approval.tenantId}:${approval.appId}:${approval.approvedAt}` : null,
      snapshotDir: dir,
      rollbackAvailable: true,
      oldProviderReadOnly: readOnly,
      credentials: revocation,
      migrationProof: fixture.migrationProof ?? null,
      reconciliation,
      problems: [],
    };
    store.saveReceipt(receipt);
    return { receipt, reconciliation, preflight };
  } catch (error) {
    if (created) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Rul et providerskift tilbage ved at gendanne snapshottet fra før cutover. */
export function rollbackSwap({ store, receipt, destDir = null, at = "2026-03-01T00:00:00Z" } = {}) {
  if (!receipt?.snapshotDir) throw new ProviderSwapError("kvitteringen peger ikke på et snapshot", "missing_snapshot");
  const target = destDir ?? store.root;
  const restored = store.constructor.restore(receipt.snapshotDir, target);
  restored.setProviderActive(receipt.from, { at, reason: "rollback" });
  const rolled = { ...receipt, at, status: "rolled-back", restoredAt: at, rollbackAvailable: false };
  restored.saveReceipt(rolled);
  return {
    status: "rolled-back",
    epoch: restored.epoch(),
    records: restored.listRecords({ provider: receipt.to, tenantId: receipt.tenantId }).length,
    fromActive: !restored.isProviderReadOnly(receipt.from),
    credentialsActive: restored.listCredentials({ provider: receipt.from, tenantId: receipt.tenantId, active: true }).map((c) => c.id),
    at,
  };
}

/** Planlæg et skift uden at skrive: preflight + de påkrævede mappings. */
export function planSwap({ fixture, providers, catalog, matrix, policy }) {
  const preflight = preflightFor({ providers, catalog, matrix, policy, fixture });
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ProviderSwapPlan",
    swapId: fixture.id,
    from: fixture.from,
    to: fixture.to,
    class: fixture.class,
    mode: preflight.mode,
    status: preflight.allowed ? "ready" : "blocked",
    preflight,
    functionalityLoss: fixture.functionalityLoss ?? [],
    steps: [
      "Kør capability-forhandling og kompatibilitetsklassificering (preflight).",
      "Stop skrivninger til den gamle provider og tag et snapshot.",
      "Map poster, id'er, ACL, links og stabile referencer til målet.",
      "Afstem antal, checksums, links, autorisation og referencespor.",
      "Indhent menneskelig godkendelse af indhold og adgangsrettigheder.",
      "Sæt den gamle provider read-only og tilbagekald dens aktive credentials.",
      "Bevar evidensen; rul tilbage til snapshottet hvis afstemningen fejler.",
    ],
  };
}
