import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, COMPONENTS, LEVELS, checkById } from "../registry.mjs";
import { renderMatrix } from "../matrix.mjs";
import { summarize, selectChecks, runCheck, parseArgs } from "../baseline.mjs";
import { captureEnvironment } from "../environment.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Find nærmeste forfader med en .git-mappe, så testen virker både i repoet og i deliverable-overlayen. */
function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
const repoRoot = findRepoRoot(here);

test("registeret har unikke check-id'er og gyldige niveauer", () => {
  const ids = new Set();
  for (const c of CHECKS) {
    assert.ok(!ids.has(c.id), `dubleret check-id: ${c.id}`);
    ids.add(c.id);
    assert.ok(LEVELS[c.level], `${c.id} har ukendt niveau ${c.level}`);
    assert.ok(Array.isArray(c.command) && c.command.length > 0, `${c.id} mangler kommando`);
    assert.ok(typeof c.component === "string" && c.component.length > 0, `${c.id} mangler komponent`);
  }
});

test("hver komponent peger på checks der findes", () => {
  for (const comp of COMPONENTS) {
    assert.ok(comp.checks.length > 0, `${comp.id} har ingen checks`);
    for (const id of comp.checks) {
      assert.doesNotThrow(() => checkById(id), `${comp.id} peger på ukendt check ${id}`);
    }
  }
});

test("eksterne checks køres ikke — de registreres som not-run", () => {
  const external = CHECKS.find((c) => c.external);
  assert.ok(external, "forventede mindst én ekstern check");
  const result = runCheck(external, { repo: here, timeout: 1000, commit: "test" });
  assert.equal(result.status, "not-run");
  assert.equal(result.exitCode, null);
  assert.equal(result.reason, external.reason);
});

test("summarize tæller alle statusser", () => {
  const s = summarize([
    { status: "pass" },
    { status: "pass" },
    { status: "fail" },
    { status: "not-run" },
    { status: "error" },
  ]);
  assert.deepEqual(s, { total: 5, pass: 2, fail: 1, error: 1, notRun: 1 });
});

test("selectChecks respekterer only og skip", () => {
  const only = selectChecks({ only: ["validate"], skip: [] });
  assert.deepEqual(only.map((c) => c.id), ["validate"]);
  const skip = selectChecks({ only: null, skip: ["validate", "lint"] });
  assert.ok(!skip.some((c) => c.id === "validate"));
  assert.ok(!skip.some((c) => c.id === "lint"));
});

test("parseArgs giver fornuftige standarder og flag", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.command, "run");
  assert.equal(defaults.timeout, 300_000);
  const render = parseArgs(["render", "--repo", "/tmp/x", "--no-fail"]);
  assert.equal(render.command, "render");
  assert.equal(render.repo, "/tmp/x");
  assert.equal(render.noFail, true);
});

test("matrix markedsfører ikke mocks/fixtures som produktion og viser NOT RUN særskilt", () => {
  const generatedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const result = {
    schemaVersion: 1,
    kind: "BaselineResult",
    generatedAt,
    status: "fail",
    summary: { total: 3, pass: 1, fail: 1, error: 0, notRun: 1 },
    environment: {
      capturedAt: generatedAt,
      node: "v22.0.0",
      npm: "10.0.0",
      platform: "linux",
      arch: "x64",
      osRelease: "6.0",
      ci: false,
      github: {},
      git: { commit: "abc", shortCommit: "abc", branch: "main", dirty: false, dirtyFiles: [] },
    },
    evidencePath: "/tmp/evidence.json",
    checks: [
      {
        id: "adapter-test",
        title: "Mattermost-adapterens tests",
        component: "mattermost-adapter",
        level: "mock",
        external: false,
        command: ["make", "adapter-test"],
        evidence: [],
        status: "pass",
        exitCode: 0,
        durationMs: 12,
        log: "logs/adapter-test.log",
        reason: null,
        gap: "Testes mod mock Mattermost, ikke en rigtig installation.",
      },
      {
        id: "changelog-check",
        title: "DCO sign-off",
        component: "gitops",
        level: "real",
        external: false,
        command: ["make", "changelog-check"],
        evidence: [],
        status: "fail",
        exitCode: 1,
        durationMs: 20,
        log: "logs/changelog-check.log",
        reason: null,
        gap: null,
      },
      {
        id: "integration-trivy",
        title: "Trivy",
        component: "security-plan",
        level: "integration",
        external: true,
        command: ["trivy", "fs", "."],
        evidence: [],
        status: "not-run",
        exitCode: null,
        durationMs: 0,
        log: "logs/integration-trivy.log",
        reason: "Trivy er ikke installeret.",
        gap: null,
      },
    ],
  };

  const md = renderMatrix(result);
  assert.match(md, /## NOT RUN/);
  assert.match(md, /Trivy er ikke installeret\./);
  assert.match(md, /## Fejl/);
  assert.match(md, /changelog-check fejlede/);
  // Mock må ikke fremstilles som real.
  assert.match(md, /Mattermost/);
  assert.match(md, /Mock/);
});

test("environment indeholder commit og versioner, ikke hemmeligheder", () => {
  const env = captureEnvironment({ repo: repoRoot });
  assert.ok(env.node.startsWith("v"));
  assert.ok("commit" in env.git);
  assert.ok(!("tokens" in env));
  assert.equal(typeof env.ci, "boolean");
});
