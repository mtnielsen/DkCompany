/**
 * DKC-008 — approval-servicen på holdbar tilstand.
 *
 * Kører den rigtige service mod SQLite-lageret og beslutningsloggen. Efter en
 * "genstart" (ny serviceinstans mod samme fil) skal den committede godkendelse
 * stadig være gyldig, og audit-kæden intakt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { migrateDatabase } from "../src/identities.mjs";
import { createSqliteApprovalStore } from "../src/adapters/approvals.mjs";
import { createSqliteApprovalLedger } from "../src/adapters/approval-ledger.mjs";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";

const EXAMPLE = JSON.parse(readFileSync(new URL("../../contracts/examples/approval-request.example.json", import.meta.url), "utf8"));
const TRAINING = ["evidence-over-prose", "when-to-reject"];
const NOW = Date.parse("2025-09-02T00:00:00Z");
const human = (id) => ({ kind: "human", id, tenantId: "acme", groups: ["platform-approvers"] });
const requester = human("oidc|requester");
const executor = { kind: "workload", id: EXAMPLE.agent.spiffeId, tenantId: "acme" };

function openService(dir) {
  const db = openDatabase({ path: join(dir, "approvals.db") });
  migrateDatabase(db);
  let internal;
  const service = createApprovalService({
    store: createSqliteApprovalStore({ db }),
    ledger: createSqliteApprovalLedger({ db, secret: "ledger-secret" }),
    trainingRegistry: () => TRAINING,
    clock: () => NOW,
    onTrustedCapability: (capability) => { internal = capability; },
  });
  return { db, service, internal, close: () => db.close() };
}

test("en godkendt anmodning overlever genstart i databasen", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-approval-"));
  try {
    const first = openService(dir);
    const req = first.service.create(structuredClone(EXAMPLE), { principal: requester });
    first.service.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
    first.service.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });
    assert.equal(first.service.mergeCheck(req.id, { principal: requester }).mergeable, true);
    assert.equal(first.internal.verifyAudit().ok, true);
    first.close();

    const second = openService(dir);
    const restored = second.service.get(req.id, { principal: requester });
    assert.equal(restored.decision.state, "approved");
    assert.equal(restored.decision.approvals.length, 2);
    assert.equal(second.service.mergeCheck(req.id, { principal: requester }).mergeable, true);
    assert.equal(second.internal.verifyAudit().ok, true);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("en afvist beslutning forbliver afvist efter genstart", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-approval-reject-"));
  try {
    const first = openService(dir);
    const req = first.service.create(structuredClone(EXAMPLE), { principal: requester });
    first.service.decide(req.id, { principal: human("oidc|rejecter"), verdict: "reject" });
    first.close();

    const second = openService(dir);
    assert.equal(second.service.get(req.id, { principal: requester }).decision.state, "rejected");
    assert.throws(() => second.service.decide(req.id, { principal: human("oidc|late"), verdict: "approve" }), (err) => err.status === 409);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reservation af en godkendelse overlever genstart og kan ikke genbruges", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-persist-approval-claim-"));
  try {
    const first = openService(dir);
    const req = first.service.create(structuredClone(EXAMPLE), { principal: requester });
    first.service.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
    first.service.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });
    const descriptor = (executionId) => ({
      approvalId: req.id,
      executionId,
      tenantId: req.tenantId,
      verb: req.change.verb,
      environment: req.change.environment,
      target: req.change.targets[0],
      diffSha256: req.change.diff.sha256,
      parameters: req.change.parameters,
      policyBundleVersion: req.evidence.policyEvaluation.bundleVersion,
    });
    const authorized = first.service.authorizeExecution(req.id, descriptor("exec-1"), { principal: executor });
    assert.equal(authorized.ok, true, authorized.reasons?.join("; "));
    first.close();

    const second = openService(dir);
    const again = second.service.authorizeExecution(req.id, descriptor("exec-2"), { principal: executor });
    assert.equal(again.ok, false);
    assert.ok(again.reasons.some((r) => /forbrugt|reserveret/.test(r)), again.reasons.join("; "));
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
