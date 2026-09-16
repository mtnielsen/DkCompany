import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChangelog, toJsonl, unsignedCommits } from "../src/changelog.mjs";
import { repoRoot } from "../src/verify.mjs";

test("git-historikken giver en maskinlæsbar change log", () => {
  let entries;
  try {
    entries = generateChangelog({ cwd: repoRoot });
  } catch (err) {
    // Ikke et git-checkout (fx et tarball); spring over.
    if (/not a git repository|git/i.test(err.message)) return;
    throw err;
  }
  assert.ok(entries.length >= 1);
  for (const e of entries) {
    assert.match(e.hash, /^[0-9a-f]{40}$/);
    assert.equal(typeof e.subject, "string");
    assert.ok(Array.isArray(e.files));
  }
});

test("JSONL-output er én linje pr. commit", () => {
  const entries = [{ hash: "a".repeat(40), subject: "x", files: [] }];
  const lines = toJsonl(entries).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), entries[0]);
});

test("usignerede commits kan identificeres", () => {
  const unsigned = unsignedCommits([{ signedOff: true }, { signedOff: false }]);
  assert.equal(unsigned.length, 1);
});
