/**
 * DKC-004 — persistence og beskyttet audit.
 *
 * Efterprøver at godkendelsestilstand overlever en genstart, at den
 * filbaserede audit-log er tamper-evident, og at et ændret binding på disken
 * opdages. Det er den del af "autentiske godkendelser", der ikke må være en
 * in-memory-erstatning.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApprovalService } from "../src/approval-service.mjs";
import { createFileStore } from "../src/store.mjs";
import { createApprovalLedger } from "../src/ledger.mjs";

const EXAMPLE = JSON.parse(readFileSync(new URL("../../contracts/examples/approval-request.example.json", import.meta.url), "utf8"));
const TRAINING = ["evidence-over-prose", "when-to-reject"];
const NOW = Date.parse("2025-09-02T00:00:00Z");

const cloneExample = () => structuredClone(EXAMPLE);
const human = (id) => ({ kind: "human", id, tenantId: "acme", groups: ["platform-approvers"] });

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-approval-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function openService(dir, { ledgerSecret = "ledger-secret" } = {}) {
  return createApprovalService({
    store: createFileStore({ dir: join(dir, "requests") }),
    ledger: createApprovalLedger({ path: join(dir, "approval-ledger.jsonl"), secret: ledgerSecret }),
    trainingRegistry: () => TRAINING,
    clock: () => NOW,
  });
}

function approveWithTwo(service) {
  const req = service.create(cloneExample());
  service.decide(req.id, { principal: human("oidc|one"), verdict: "approve" });
  service.decide(req.id, { principal: human("oidc|two"), verdict: "approve" });
  return req;
}

test("godkendelse overlever genstart via filbaseret lager", () => {
  const { dir, cleanup } = tempDir();
  try {
    const first = openService(dir);
    const req = approveWithTwo(first);
    assert.equal(first.mergeCheck(req.id).mergeable, true);
    assert.equal(first.verifyAudit().ok, true);

    const restarted = openService(dir);
    const restored = restarted.get(req.id);
    assert.equal(restored.decision.state, "approved");
    assert.equal(restored.decision.approvals.length, 2);
    assert.equal(restarted.mergeCheck(req.id).mergeable, true, "godkendelsen skal stadig være gyldig efter genstart");
    assert.equal(restarted.verifyAudit().ok, true);
    assert.ok(restarted.audit.entries.length >= 3, "oprettelse + to beslutninger skal være logget");
  } finally {
    cleanup();
  }
});

test("afvist beslutning forbliver afvist efter genstart", () => {
  const { dir, cleanup } = tempDir();
  try {
    const first = openService(dir);
    const req = first.create(cloneExample());
    first.decide(req.id, { principal: human("oidc|rejecter"), verdict: "reject" });

    const restarted = openService(dir);
    assert.equal(restarted.get(req.id).decision.state, "rejected");
    assert.equal(restarted.mergeCheck(req.id).mergeable, false);
    assert.throws(() => restarted.decide(req.id, { principal: human("oidc|late"), verdict: "approve" }), (err) => err.status === 409);
  } finally {
    cleanup();
  }
});

test("et brud på audit-loggen opdages ved start (fail-closed)", () => {
  const { dir, cleanup } = tempDir();
  try {
    const ledgerPath = join(dir, "approval-ledger.jsonl");
    const service = openService(dir);
    service.create(cloneExample());

    const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
    assert.ok(lines.length >= 1);
    const tampered = JSON.parse(lines[0]);
    tampered.state = "approved"; // efterfølgende ændring uden ny hash
    lines[0] = JSON.stringify(tampered);
    writeFileSync(ledgerPath, lines.join("\n") + "\n");

    assert.throws(
      () => createApprovalLedger({ path: ledgerPath, secret: "ledger-secret" }),
      (err) => err.code === "AUDIT_CHAIN_BROKEN"
    );
  } finally {
    cleanup();
  }
});

test("HMAC-hemmeligheden gør audit-loggen uforfalskelig uden nøglen", () => {
  const { dir, cleanup } = tempDir();
  try {
    const ledgerPath = join(dir, "approval-ledger.jsonl");
    const service = openService(dir, { ledgerSecret: "right-secret" });
    service.create(cloneExample());

    // En angriber læser filen med den forkerte hemmelighed: kæden kan ikke
    // verificeres, fordi hash'en er en HMAC.
    assert.throws(
      () => createApprovalLedger({ path: ledgerPath, secret: "wrong-secret" }),
      (err) => err.code === "AUDIT_CHAIN_BROKEN"
    );
    // Den rigtige hemmelighed verificerer fint.
    assert.equal(createApprovalLedger({ path: ledgerPath, secret: "right-secret" }).verifyChain().ok, true);
  } finally {
    cleanup();
  }
});

test("et ændret binding på disken opdages og ugyldiggør godkendelsen", () => {
  const { dir, cleanup } = tempDir();
  try {
    const first = openService(dir);
    const req = approveWithTwo(first);
    assert.equal(first.mergeCheck(req.id).mergeable, true);

    const requestsDir = join(dir, "requests");
    const file = readdirSync(requestsDir).find((f) => f.endsWith(".json"));
    const path = join(requestsDir, file);
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.change.diff.sha256 = "e".repeat(64); // ændr ændringen uden om servicen
    writeFileSync(path, JSON.stringify(data, null, 2));

    const restarted = openService(dir);
    const merge = restarted.mergeCheck(req.id);
    assert.equal(merge.mergeable, false);
    assert.ok(merge.reasons.some((r) => /binding/i.test(r)), `forventede binding-begrundelse, fik: ${merge.reasons.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("id med stiskifte kan ikke skrive uden for lagermappen", () => {
  const { dir, cleanup } = tempDir();
  try {
    const store = createFileStore({ dir: join(dir, "requests") });
    store.save({ id: "../../evil", decision: { state: "pending" } });
    assert.equal(existsSync(join(dir, "evil.json")), false);
    assert.equal(existsSync(join(dir, "..", "evil.json")), false);
    const loaded = store.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "../../evil");
  } finally {
    cleanup();
  }
});
