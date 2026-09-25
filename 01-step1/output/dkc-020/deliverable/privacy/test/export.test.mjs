import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore, makeExportService } from "./support/fixture.mjs";
import { createExportService, ExportError } from "../src/export.mjs";
import { createMemoryArtifactStore } from "../src/artifact-store.mjs";

const identifiers = [{ type: "email", value: "kunde@example.org", normalised: "kunde@example.org" }];
const modules = [
  { module: "mattermost-adapter", records: [{ id: "p1", message: "hej" }, { subjectId: "other", tenantId: "acme", identifiers: [{ type: "email", value: "anden@example.org" }] }] },
  { module: "keycloak-adapter", records: [{ type: "user", value: { id: "u1" } }] },
];

function issued(store, artifactStore = createMemoryArtifactStore()) {
  const exportService = createExportService({ store, artifactStore });
  return { exportService, artifactStore };
}

test("en eksport udstedes med udløb og digest og kan indløses af modtageren", () => {
  const { store, cleanup } = makeStore();
  try {
    const { exportService } = issued(store);
    const exp = exportService.issue({ tenantId: "acme", caseId: "case-1", verb: "subject.export", recipient: "oidc|dpo.anna", identifiers, modules });
    assert.equal(exp.status, "active");
    assert.match(exp.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(exp.expiresAt) > Date.parse(exp.createdAt));

    const redeemed = exportService.redeem({ tenantId: "acme", exportId: exp.exportId, recipient: "oidc|dpo.anna" });
    assert.equal(redeemed.status, "redeemed");
    // Anden persons post er udeladt, subjektets egne er med.
    assert.equal(redeemed.payload.recordCount, 2);
    assert.equal(redeemed.payload.dropped, 1);
    assert.ok(redeemed.payload.records.every((r) => !JSON.stringify(r.value).includes("anden@example.org")));
  } finally {
    cleanup();
  }
});

test("et udløbet link afvises og markeres expired", () => {
  const { store, cleanup } = makeStore();
  try {
    const { exportService } = issued(store);
    const exp = exportService.issue({ tenantId: "acme", caseId: "case-1", verb: "subject.export", recipient: "oidc|dpo.anna", identifiers, modules, now: Date.parse("2026-01-01T00:00:00Z") });
    assert.throws(
      () => exportService.redeem({ tenantId: "acme", exportId: exp.exportId, recipient: "oidc|dpo.anna", now: Date.parse("2026-01-01T02:00:00Z") }),
      (err) => err instanceof ExportError && err.code === "export_expired"
    );
    assert.equal(store.getExport("acme", exp.exportId).status, "expired");
  } finally {
    cleanup();
  }
});

test("en forkert modtager og en fremmed tenant afvises", () => {
  const { store, cleanup } = makeStore();
  try {
    const { exportService } = issued(store);
    const exp = exportService.issue({ tenantId: "acme", caseId: "case-1", verb: "subject.export", recipient: "oidc|dpo.anna", identifiers, modules });
    assert.throws(() => exportService.redeem({ tenantId: "acme", exportId: exp.exportId, recipient: "oidc|anden" }), (err) => err.code === "recipient_mismatch");
    assert.throws(() => exportService.redeem({ tenantId: "globex", exportId: exp.exportId, recipient: "oidc|dpo.anna" }), (err) => err.code === "export_not_found");
  } finally {
    cleanup();
  }
});

test("et tilbagekaldt link og et manipuleret artefakt afvises", () => {
  const { store, cleanup } = makeStore();
  try {
    const { exportService, artifactStore } = issued(store);
    const exp = exportService.issue({ tenantId: "acme", caseId: "case-1", verb: "subject.export", recipient: "oidc|dpo.anna", identifiers, modules });
    exportService.revoke({ tenantId: "acme", exportId: exp.exportId });
    assert.throws(() => exportService.redeem({ tenantId: "acme", exportId: exp.exportId, recipient: "oidc|dpo.anna" }), (err) => err.code === "export_revoked");

    const second = exportService.issue({ tenantId: "acme", caseId: "case-2", verb: "subject.export", recipient: "oidc|dpo.anna", identifiers, modules });
    const tampering = { ...artifactStore, raw(uri) { const r = artifactStore.raw(uri); return r === null ? null : r.replace("hej", "hacked"); } };
    const tampered = createExportService({ store, artifactStore: tampering });
    assert.throws(() => tampered.redeem({ tenantId: "acme", exportId: second.exportId, recipient: "oidc|dpo.anna" }), (err) => err.code === "artifact_tampered");
  } finally {
    cleanup();
  }
});

test("eksportregisteret indeholder kun metadata, ikke persondata", () => {
  const { store, cleanup } = makeStore();
  try {
    const { exportService } = issued(store);
    exportService.issue({ tenantId: "acme", caseId: "case-1", verb: "subject.export", recipient: "oidc|dpo.anna", identifiers, modules });
    const exports = store.listExports("acme", "case-1");
    assert.equal(exports.length, 1);
    assert.equal(JSON.stringify(exports[0]).includes("kunde@example.org"), false);
  } finally {
    cleanup();
  }
});
