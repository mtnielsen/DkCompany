import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runVerify, repoRoot } from "../src/verify.mjs";

test("det rigtige repo består alle GitOps-gates", () => {
  const report = runVerify(repoRoot, { excludeModules: ["dummy-broken"] });
  const failed = report.checks.filter((c) => c.status === "fail");
  assert.equal(report.status, "pass", JSON.stringify(failed, null, 2));
  assert.ok(report.summary.total >= 8);
});

test("flydende image-tag og manglende labels fejler", () => {
  const root = mkdtempSync(join(tmpdir(), "gitops-verify-"));
  try {
    const dir = join(root, "gitops", "manifests", "dev");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "bad.json"),
      JSON.stringify({
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "bad", namespace: "platform" },
        spec: { template: { spec: { containers: [{ name: "bad", image: "ghcr.io/example/bad:latest" }] } } },
      })
    );
    const report = runVerify(root, {});
    const failed = new Set(report.checks.filter((c) => c.status === "fail").map((c) => c.id));
    assert.equal(report.status, "fail");
    assert.ok(failed.has("G-002"), "image-pinning skal fejle");
    assert.ok(failed.has("G-003"), "labels skal fejle");
    assert.ok(failed.has("G-005"), "hardening skal fejle");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("en agent-ServiceAccount med kontrolplans-adgang fejler G-009", () => {
  const root = mkdtempSync(join(tmpdir(), "gitops-agent-rbac-"));
  try {
    const manifests = join(root, "gitops", "manifests", "dev");
    mkdirSync(manifests, { recursive: true });
    mkdirSync(join(root, "modules", "evil", "agents"), { recursive: true });
    writeFileSync(join(root, "modules", "evil", "agents", "agent.json"), JSON.stringify({ role: "executor" }));
    const labels = { "app.kubernetes.io/name": "evil", "app.kubernetes.io/managed-by": "argocd", "platform.example.org/module": "evil", "platform.example.org/environment": "dev" };
    writeFileSync(join(manifests, "sa.json"), JSON.stringify({ apiVersion: "v1", kind: "ServiceAccount", metadata: { name: "evil", namespace: "platform", labels } }));
    writeFileSync(join(manifests, "role.json"), JSON.stringify({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", metadata: { name: "evil-role", namespace: "platform", labels }, rules: [{ apiGroups: [""], resources: ["secrets"], verbs: ["create", "update"] }] }));
    writeFileSync(join(manifests, "binding.json"), JSON.stringify({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", metadata: { name: "evil-binding", namespace: "platform", labels }, subjects: [{ kind: "ServiceAccount", name: "evil", namespace: "platform" }], roleRef: { kind: "Role", name: "evil-role" } }));
    const report = runVerify(root, {});
    const failed = new Set(report.checks.filter((c) => c.status === "fail").map((c) => c.id));
    assert.ok(failed.has("G-009"), "agent-RBAC mod kontrolplanet skal fejle");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
