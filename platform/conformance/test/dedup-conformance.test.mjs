import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDedupPolicyDir, validateDedupReceiptDir, validateDedupReceipt } from "../src/dedup.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

test("dedup-politik- og receipt-eksemplerne validerer (skema + semantik)", () => {
  const policies = validateDedupPolicyDir(examplesDir);
  assert.equal(policies.length, 1);
  assert.equal(policies[0].ok, true, JSON.stringify(policies[0].errors));
  const receipts = validateDedupReceiptDir(examplesDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].ok, true, JSON.stringify(receipts[0].errors));
});

test("et receipt må ikke aktivere en besparelse uden bestået integritet og restore", () => {
  const receipt = JSON.parse(readFileSync(join(examplesDir, "dedup-receipt.example.json"), "utf8"));
  const broken = structuredClone(receipt);
  broken.integrity.ok = false;
  broken.integrity.corruptions = [{ chunkId: "abc", reason: "auth-failed", snapshots: ["snap-a"] }];
  assert.equal(validateDedupReceipt(broken).ok, false);
});

test("et receipt med korruptioner eller negativ besparelse afvises", () => {
  const receipt = JSON.parse(readFileSync(join(examplesDir, "dedup-receipt.example.json"), "utf8"));
  const corrupted = structuredClone(receipt);
  corrupted.integrity.corruptions = [{ chunkId: "abc", reason: "auth-failed", snapshots: ["snap-a"] }];
  assert.ok(validateDedupReceipt(corrupted).errors.some((e) => e.path === "/integrity/corruptions"));
  const impossible = structuredClone(receipt);
  impossible.physicalBytes = impossible.logicalBytes + 1;
  impossible.savingsActive = false;
  assert.ok(validateDedupReceipt(impossible).errors.some((e) => e.path === "/physicalBytes"));
});

test("når restore er ok må intet snapshot fejle", () => {
  const receipt = JSON.parse(readFileSync(join(examplesDir, "dedup-receipt.example.json"), "utf8"));
  const broken = structuredClone(receipt);
  broken.restore.snapshots[0].ok = false;
  assert.ok(validateDedupReceipt(broken).errors.some((e) => e.path === "/restore/snapshots"));
});
