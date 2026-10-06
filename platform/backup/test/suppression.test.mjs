import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuppressionLedger, SuppressionError } from "../src/suppression.mjs";

function ledger() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-suppression-"));
  return { dir, ledger: createSuppressionLedger({ path: join(dir, "suppression.ndjson") }) };
}

test("en tom journal har genesis-hovedet", () => {
  const { dir, ledger: l } = ledger();
  try {
    assert.equal(l.head(), l.genesis);
    assert.equal(l.verify().ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("append kæder poster og verificerer", () => {
  const { dir, ledger: l } = ledger();
  try {
    const first = l.append({ tenantId: "acme", digest: "a".repeat(64) });
    const second = l.append({ tenantId: "acme", digest: "b".repeat(64) });
    assert.notEqual(first.hash, second.hash);
    assert.equal(l.verify().ok, true);
    assert.equal(l.isDescendantOf(first.hash), true);
    assert.equal(l.isDescendantOf("c".repeat(64)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("en ændret post opdages", () => {
  const { dir, ledger: l } = ledger();
  try {
    l.append({ tenantId: "acme", digest: "a".repeat(64) });
    l.append({ tenantId: "acme", digest: "b".repeat(64) });
    const lines = readFileSync(l.path, "utf8").trim().split("\n");
    const entry = JSON.parse(lines[0]);
    entry.reason = "manipuleret";
    lines[0] = JSON.stringify(entry);
    writeFileSync(l.path, `${lines.join("\n")}\n`);
    assert.equal(l.verify().ok, false);
    assert.ok(l.verify().problems.some((p) => p.type === "changed"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("et ugyldigt digest afvises", () => {
  const { dir, ledger: l } = ledger();
  try {
    assert.throws(() => l.append({ tenantId: "acme", digest: "ikke-et-digest" }), SuppressionError);
    assert.throws(() => l.append({ digest: "a".repeat(64) }), SuppressionError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
