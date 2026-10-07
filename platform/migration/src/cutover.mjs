/**
 * DKC-031 — cutover og rollback.
 *
 * En cutover må kun gennemføres når:
 *   1. en import-afstemning viser, at antal og checksums stemmer, og at der
 *      ikke er fejl eller uafklarede dubletkonflikter,
 *   2. den tabte funktionalitet er kendt og vist (den blokeres ikke, men den
 *      står i cutover-planen),
 *   3. pilotbrugerne har godkendt både indhold og adgangsrettigheder, og
 *   4. en rollback til et snapshot før cutover er dokumenteret.
 *
 * Snapshot'et tages **før** cutover, så en rollback kan gendanne både poster og
 * rettigheder.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMigrationAccess } from "./permissions.mjs";

export class MigrationCutoverError extends Error {
  constructor(message, code = "migration_cutover_error", status = 409) {
    super(message);
    this.name = "MigrationCutoverError";
    this.code = code;
    this.status = status;
  }
}

export function planCutover({ store, source, reconciliation, operatorSubject = null } = {}) {
  const problems = [];
  if (!reconciliation || reconciliation.mode !== "import") {
    problems.push({ path: "/reconciliation", message: "cutover kræver en import-afstemning" });
  } else {
    if (reconciliation.persisted !== true) problems.push({ path: "/reconciliation/persisted", message: "afstemningen er ikke fra en gennemført import" });
    if (reconciliation.checksums?.match !== true) problems.push({ path: "/reconciliation/checksums/match", message: "checksums afstemmer ikke" });
    if ((reconciliation.errors ?? []).length) problems.push({ path: "/reconciliation/errors", message: `der er ${reconciliation.errors.length} fejl i fejllisten` });
    if ((reconciliation.conflicts ?? []).length) problems.push({ path: "/reconciliation/conflicts", message: `der er ${reconciliation.conflicts.length} uafklarede dubletkonflikter` });
  }
  const approval = store.getApproval(source.tenantId, source.appId);
  if (!approval) problems.push({ path: "/approval", message: "pilotbrugerne har ikke godkendt indhold og adgangsrettigheder" });
  if (approval && operatorSubject && approval.approvedBy?.subject === operatorSubject) {
    problems.push({ path: "/approval/approvedBy", message: "den der udførte migrationen kan ikke selv godkende" });
  }
  const rollback = {
    available: true,
    strategy: "snapshot-before-cutover",
    restoresRights: true,
    steps: [
      "Stop skrivninger til den nye platform for app'en.",
      "Gendan butikkens snapshot fra før cutover (poster, ACL og rettigheder).",
      "Genåbn den gamle kilde som system-of-record.",
      "Registrér rollback og grund i revisionssporet.",
    ],
  };
  const coverageLosses = reconciliation?.coverageLosses ?? [];
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationCutoverPlan",
    tenantId: source.tenantId,
    appId: source.appId,
    status: problems.length === 0 ? "ready" : "blocked",
    problems,
    approval,
    coverageLosses,
    lostFunctionality: coverageLosses.map((entry) => `${entry.entityType}/${entry.facet}: ${entry.note ?? entry.status}`),
    rollback,
  };
}

export function executeCutover({ store, source, principal, reconciliation, operatorSubject = null, at = "2026-03-01T00:00:00Z", snapshotDir = null } = {}) {
  assertMigrationAccess({ principal, source, action: "cutover" });
  const plan = planCutover({ store, source, reconciliation, operatorSubject });
  const approval = store.getApproval(source.tenantId, source.appId);
  if (!approval) throw new MigrationCutoverError("cutover kræver en pilotgodkendelse", "approval_required");
  if (approval.approvedBy?.subject === operatorSubject) throw new MigrationCutoverError("operatøren kan ikke selv godkende", "two_person_required", 403);
  if (plan.problems.length) throw new MigrationCutoverError(plan.problems[0].message, "cutover_blocked");

  const dir = snapshotDir ?? mkdtempSync(join(tmpdir(), "dkc031-cutover-"));
  const created = snapshotDir === null;
  try {
    const snapshotRef = `cutover-snapshots/${source.tenantId}-${source.appId}-${store.epoch()}`;
    store.snapshot(dir);
    const epochBefore = store.epoch();
    const receipt = {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "MigrationCutoverReceipt",
      sourceId: source.id,
      tenantId: source.tenantId,
      appId: source.appId,
      at,
      epochBefore,
      epochAfter: epochBefore,
      approvalRef: `${approval.tenantId}:${approval.appId}:${approval.approvedAt}`,
      snapshotDir: dir,
      snapshotRef,
      rollbackAvailable: true,
      restoresRights: true,
      status: "cutover",
    };
    store.saveCutover(receipt);
    return receipt;
  } catch (error) {
    if (created) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Rul en cutover tilbage ved at gendanne snapshot'et fra før cutover. */
export function rollbackCutover({ store, receipt, destDir = null, at = "2026-03-01T00:00:00Z" } = {}) {
  if (!receipt?.snapshotDir) throw new MigrationCutoverError("cutover-kvitteringen peger ikke på et snapshot", "missing_snapshot");
  const target = destDir ?? store.root;
  const restored = store.constructor.restore(receipt.snapshotDir, target);
  restored.saveCutover({ ...receipt, at, status: "rolled-back", restoredAt: at, rollbackAvailable: false });
  return { status: "rolled-back", epoch: restored.epoch(), records: restored.listRecords({ tenantId: receipt.tenantId, appId: receipt.appId }).length, at };
}
