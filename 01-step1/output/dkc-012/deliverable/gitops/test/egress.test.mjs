/**
 * DKC-012 — GitOps-gates for model-egress.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyModelEgress } from "../src/egress.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-egress-"));
  cpSync(join(repoRoot, "gitops", "manifests"), join(dir, "gitops", "manifests"), { recursive: true });
  cpSync(join(repoRoot, "gitops", "apps"), join(dir, "gitops", "apps"), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("den ønskede klyngetilstand blokerer model-egress uden om gatewayen", () => {
  const report = verifyModelEgress(repoRoot);
  assert.equal(report.status, "pass");
  assert.equal(report.summary.fail, 0);
});

test("manglende default-deny opdages", () => {
  const { dir, cleanup } = fixture();
  try {
    rmSync(join(dir, "gitops", "manifests", "dev", "model-egress-default-deny.json"));
    const report = verifyModelEgress(dir);
    assert.equal(report.status, "fail");
    assert.ok(report.checks.find((c) => c.id === "E-001").status === "fail");
  } finally {
    cleanup();
  }
});

test("en workload med leverandørnøgle opdages", () => {
  const { dir, cleanup } = fixture();
  try {
    const path = join(dir, "gitops", "manifests", "dev", "pdp-deployment.json");
    const deployment = JSON.parse(readFileSync(path, "utf8"));
    deployment.spec.template.spec.containers[0].env.push({ name: "OPENAI_API_KEY", value: "sk-test" });
    writeFileSync(path, JSON.stringify(deployment));
    const report = verifyModelEgress(dir);
    assert.equal(report.status, "fail");
    assert.ok(report.checks.find((c) => c.id === "E-003").status === "fail");
  } finally {
    cleanup();
  }
});
