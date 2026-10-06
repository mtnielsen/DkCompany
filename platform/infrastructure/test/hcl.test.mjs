import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkIac, extractBlocks, IAC_DIR } from "../src/hcl.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function copyModule() {
  const root = mkdtempSync(join(tmpdir(), "dkc015-iac-"));
  cpSync(join(repoRoot, IAC_DIR), join(root, IAC_DIR), { recursive: true });
  return root;
}

test("extractBlocks matcher nested braces", () => {
  const blocks = extractBlocks('rule {\n  inner { a = 1 }\n}\n', "rule");
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /inner \{ a = 1 \}/);
});

test("det rigtige IaC-modul består den statiske kontrol", () => {
  assert.deepEqual(checkIac(repoRoot).problems, []);
});

test("en uplåst provider afvises", () => {
  const root = copyModule();
  try {
    const versions = join(root, IAC_DIR, "versions.tf");
    writeFileSync(versions, readFileSync(versions, "utf8") + '\nprovider "random" {\n  source = "hashicorp/random"\n}\n');
    assert.ok(checkIac(root).problems.some((p) => /ikke versionlåst/.test(p)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("en klartekst-hemmelighed i IaC afvises", () => {
  const root = copyModule();
  try {
    const network = join(root, IAC_DIR, "network.tf");
    writeFileSync(network, readFileSync(network, "utf8") + '\nlocals {\n  api_token = "super-secret-value"\n}\n');
    assert.ok(checkIac(root).problems.some((p) => /klartekst-hemmelighed/.test(p)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
