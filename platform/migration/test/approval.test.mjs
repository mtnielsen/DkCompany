import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, PRINCIPALS, AT } from "./helpers.mjs";
import { recordApproval, MigrationApprovalError } from "../src/approval.mjs";
import { migrationApprovalProblems } from "../src/model.mjs";

test("en godkendelse kræver et navngivet menneske og begge godkendelser", () => {
  const { store, cleanup } = fixture();
  assert.throws(
    () => recordApproval({ store, principal: { kind: "service", id: "svc|migration" }, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://x" }),
    (error) => error instanceof MigrationApprovalError,
  );
  assert.throws(
    () => recordApproval({ store, principal: PRINCIPALS.ada, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: false, evidenceRef: "evidence://x" }),
    (error) => error instanceof MigrationApprovalError,
  );
  cleanup();
});

test("en gyldig pilotgodkendelse gemmes og består semantikken", () => {
  const { store, cleanup } = fixture();
  const approval = recordApproval({ store, principal: PRINCIPALS.ada, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://pilot/files", at: AT });
  assert.equal(store.getApproval("acme", "files").approvedBy.subject, "oidc|ada.acme");
  assert.deepEqual(migrationApprovalProblems(approval, { tenantId: "acme", appId: "files" }), []);
  cleanup();
});

test("operatøren kan ikke godkende sin egen migration", () => {
  const { store, cleanup } = fixture();
  assert.throws(
    () => recordApproval({ store, principal: PRINCIPALS.operator, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://x", operatorSubject: PRINCIPALS.operator.id }),
    (error) => error instanceof MigrationApprovalError,
  );
  cleanup();
});

test("en godkendelse fra en anden tenant afvises", () => {
  const { store, cleanup } = fixture();
  assert.throws(
    () => recordApproval({ store, principal: PRINCIPALS.gus, tenantId: "acme", appId: "files", contentApproved: true, aclApproved: true, evidenceRef: "evidence://x" }),
    (error) => error.code === "tenant_mismatch",
  );
  cleanup();
});
