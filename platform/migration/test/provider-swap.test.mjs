import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, REPORT_GENERATED_AT } from "../src/provider-model.mjs";
import { recordApproval } from "../src/approval.mjs";
import { FileProviderStore } from "../src/provider-store.mjs";
import { planSwap, executeSwap, rollbackSwap, mapProviderRecord, ProviderSwapError } from "../src/provider-swap.mjs";
import { decideProviderSwapAccess } from "../src/provider-permissions.mjs";
import { PRINCIPALS } from "../src/provider-check.mjs";

function setup() {
  const all = loadAll(repoRoot);
  const root = mkdtempSync(join(tmpdir(), "dkc059-test-"));
  const snapshotsDir = mkdtempSync(join(tmpdir(), "dkc059-snaptest-"));
  const store = FileProviderStore.open(root);
  for (const provider of all.providers.providers) {
    store.addCredential({ id: `${provider.id}-svc`, provider: provider.id, tenantId: "acme", secretRef: `vault://providers/${provider.id}` });
  }
  process.on("exit", () => {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotsDir, { recursive: true, force: true });
  });
  const fixture = (id) => all.swaps.find((s) => s.fixture.id === id).fixture;
  return { all, store, root, snapshotsDir, fixture };
}

function approve(store, fixture) {
  return recordApproval({ store, principal: PRINCIPALS.ada, tenantId: fixture.tenantId, appId: fixture.appId, contentApproved: true, aclApproved: true, evidenceRef: `evidence://provider/${fixture.id}`, at: REPORT_GENERATED_AT });
}

function execute({ all, store, snapshotsDir, fixture }) {
  return executeSwap({ store, fixture, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PRINCIPALS.ada, approval: approve(store, fixture), at: REPORT_GENERATED_AT, snapshotDir: join(snapshotsDir, fixture.id) });
}

test("verificeret backendudskiftning afstemmer data, ACL, links og referencer", () => {
  const { all, store, fixture, snapshotsDir } = setup();
  const f = fixture("storage-filesystem-to-object-store");
  const { receipt, reconciliation } = execute({ all, store, snapshotsDir, fixture: f });
  assert.equal(reconciliation.checksums.match, true);
  assert.equal(reconciliation.links.preserved, true);
  assert.equal(reconciliation.authorization.preserved, true);
  assert.equal(reconciliation.references.preserved, true);
  assert.equal(reconciliation.counts.created, f.records.length);
  assert.equal(receipt.status, "cutover");
  assert.equal(receipt.oldProviderReadOnly, true);
  assert.equal(store.isProviderReadOnly(f.from), true);
  assert.equal(store.listCredentials({ provider: f.from, tenantId: f.tenantId, active: true }).length, 0);
  assert.equal(receipt.credentials.evidenceRetained, true);
  assert.ok(receipt.credentials.revoked.length >= 1);
  rmSync(store.root, { recursive: true, force: true });
});

test("rollback gendanner poster, id-mapping og aktive credentials", () => {
  const { all, store, fixture, snapshotsDir } = setup();
  const f = fixture("storage-filesystem-to-object-store");
  const { receipt } = execute({ all, store, snapshotsDir, fixture: f });
  const dest = mkdtempSync(join(tmpdir(), "dkc059-restore-"));
  const rolled = rollbackSwap({ store, receipt, destDir: dest, at: REPORT_GENERATED_AT });
  assert.equal(rolled.status, "rolled-back");
  assert.equal(rolled.records, 0);
  assert.equal(rolled.fromActive, true);
  assert.ok(rolled.credentialsActive.includes(`${f.from}-svc`));
  rmSync(dest, { recursive: true, force: true });
  rmSync(store.root, { recursive: true, force: true });
});

test("appmigration viser funktionstab og afstemmer referencer", () => {
  const { all, store, fixture, snapshotsDir } = setup();
  const f = fixture("files-app-nextcloud-to-dkc-apps");
  const plan = planSwap({ fixture: f, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy });
  assert.equal(plan.status, "ready");
  const { reconciliation } = execute({ all, store, snapshotsDir, fixture: f });
  assert.equal(reconciliation.checksums.match, true);
  assert.equal(reconciliation.functionalityLoss.length, 2);
  assert.ok(reconciliation.functionalityLoss.every((entry) => entry.note));
  assert.equal(reconciliation.references.preserved, true);
  rmSync(store.root, { recursive: true, force: true });
});

test("IAM-skift bevarer entydig identitet og historisk audit-provenance", () => {
  const { all, store, fixture, snapshotsDir } = setup();
  const f = fixture("iam-keycloak-to-entra");
  const { reconciliation } = execute({ all, store, snapshotsDir, fixture: f });
  assert.equal(reconciliation.identity.preserved, true);
  assert.equal(reconciliation.auditProvenance.preserved, true);
  assert.equal(reconciliation.checksums.match, true);
  const stored = store.listRecords({ provider: f.to, tenantId: f.tenantId });
  const subjects = stored.map((r) => r.identity.subject);
  assert.equal(new Set(subjects).size, subjects.length);
  assert.ok(stored.every((r) => r.auditProvenance.length >= 1));
  rmSync(store.root, { recursive: true, force: true });
});

test("et ikke-understøttet skift afvises før ændring", () => {
  const { all, store, fixture, snapshotsDir } = setup();
  const original = fixture("files-app-nextcloud-to-dkc-apps");
  const unsupported = { ...original, id: "nextcloud-to-bookstack", from: "nextcloud", to: "bookstack", mode: "unsupported", migrationProof: null };
  assert.throws(
    () => executeSwap({ store, fixture: unsupported, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PRINCIPALS.ada, approval: approve(store, unsupported), at: REPORT_GENERATED_AT }),
    (error) => error instanceof ProviderSwapError && error.code === "preflight_blocked",
  );
  assert.equal(store.listRecords({ provider: unsupported.to, tenantId: unsupported.tenantId }).length, 0);
  rmSync(store.root, { recursive: true, force: true });
});

test("cutover kræver en menneskelig godkendelse", () => {
  const { all, store, fixture, snapshotsDir } = setup();
  const f = fixture("storage-filesystem-to-object-store");
  assert.throws(
    () => executeSwap({ store, fixture: f, providers: all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, principal: PRINCIPALS.ada, approval: null, at: REPORT_GENERATED_AT }),
    (error) => error.code === "approval_required",
  );
  rmSync(store.root, { recursive: true, force: true });
});

test("en post fra en anden tenant afvises", () => {
  const { all, fixture } = setup();
  const f = fixture("storage-filesystem-to-object-store");
  const crossTenant = { ...f, records: [{ ...f.records[0], owner: { subject: "oidc|gus.globex", tenantId: "globex" } }] };
  assert.throws(
    () => mapProviderRecord({ fixture: crossTenant, record: crossTenant.records[0] }),
    (error) => error.code === "cross_tenant_record",
  );
  void all;
});

test("id-mapping er deterministisk og bevarer den stabile reference", () => {
  const { fixture } = setup();
  const f = fixture("storage-filesystem-to-object-store");
  const first = mapProviderRecord({ fixture: f, record: f.records[0] });
  const second = mapProviderRecord({ fixture: f, record: f.records[0] });
  assert.equal(first.targetId, second.targetId);
  assert.equal(first.reference, f.records[0].references[0]);
});

test("adgang er default-deny og rollebeskyttet", () => {
  assert.equal(decideProviderSwapAccess({ principal: PRINCIPALS.ada, tenantId: "acme", action: "cutover" }).allowed, true);
  assert.equal(decideProviderSwapAccess({ principal: PRINCIPALS.ben, tenantId: "acme", action: "cutover" }).allowed, false);
  assert.equal(decideProviderSwapAccess({ principal: PRINCIPALS.gus, tenantId: "acme", action: "read" }).allowed, false);
  assert.equal(decideProviderSwapAccess({ principal: null, tenantId: "acme", action: "read" }).allowed, false);
});
