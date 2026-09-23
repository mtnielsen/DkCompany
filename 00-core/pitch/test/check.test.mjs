import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDeck, check, extractEvidence, makeTargets } from "../src/check.mjs";
import { repoRoot } from "../src/cli.mjs";

test("extractEvidence finder Bevis-linjer og backtick-spans", () => {
  const evidence = extractEvidence("## S\n**Pointe:** x\n**Bevis:** `make conform` · `contracts/x.json`\n");
  assert.equal(evidence.length, 1);
  assert.deepEqual(evidence[0].spans, ["make conform", "contracts/x.json"]);
});

test("makeTargets finder mål og springer flag og dot-filer over", () => {
  const targets = makeTargets("help: ## x\nci: a b\n.DEFAULT_GOAL := help\n");
  assert.ok(targets.has("help"));
  assert.ok(targets.has("ci"));
  assert.ok(!targets.has(".DEFAULT_GOAL"));
});

test("det rigtige deck består", () => {
  const result = check({ repoRoot });
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.ok(result.evidence.length >= 10, "forventer mindst ti bevis-linjer");
});

test("checkDeck fanger ukendte make-mål og stier", () => {
  const result = checkDeck({
    markdown: "**Bevis:** `make findes-ikke` · `docs/findes-ikke.md`\n",
    makefileText: "ci: x\n",
    repoRoot: "/tmp",
    exists: () => false,
    minEvidence: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("findes-ikke")));
  assert.ok(result.problems.some((p) => p.includes("docs/findes-ikke.md")));
});
