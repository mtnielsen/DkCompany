import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPlan } from "../src/render.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function resourcesFor(envId) {
  return [...renderPlan(repoRoot).manifests.entries()].filter(([rel]) => rel.startsWith(`gitops/manifests/${envId}/`)).map(([, value]) => value);
}

test("renderingen er deterministisk", () => {
  assert.deepEqual([...renderPlan(repoRoot).manifests.keys()], [...renderPlan(repoRoot).manifests.keys()]);
});

test("dev genskabes ikke, men staging og prod gør", () => {
  const keys = [...renderPlan(repoRoot).manifests.keys()];
  assert.ok(keys.some((k) => k.startsWith("gitops/manifests/staging/")));
  assert.ok(keys.some((k) => k.startsWith("gitops/manifests/prod/")));
  assert.ok(!keys.some((k) => k.startsWith("gitops/manifests/dev/")));
});

test("hver ressource bærer de obligatoriske labels", () => {
  for (const resource of resourcesFor("staging")) {
    for (const label of ["app.kubernetes.io/name", "app.kubernetes.io/managed-by", "platform.example.org/module", "platform.example.org/environment"]) {
      assert.ok(resource.metadata?.labels?.[label], `${resource.kind} ${resource.metadata?.name} mangler ${label}`);
    }
  }
});

test("Deployments er hærdet og har et writable data-volume", () => {
  const deployments = resourcesFor("staging").filter((r) => r.kind === "Deployment");
  assert.ok(deployments.length >= 4);
  for (const deployment of deployments) {
    const pod = deployment.spec.template.spec;
    assert.equal(pod.securityContext.runAsNonRoot, true);
    for (const container of pod.containers) {
      assert.equal(container.securityContext.readOnlyRootFilesystem, true);
      assert.equal(container.securityContext.allowPrivilegeEscalation, false);
      assert.ok(container.securityContext.capabilities.drop.includes("ALL"));
      assert.ok(container.volumeMounts.some((m) => m.mountPath === "/data"));
    }
  }
});

test("ingen Secret-objekter committes; secrets er referencer", () => {
  for (const envId of ["staging", "prod"]) {
    assert.equal(resourcesFor(envId).filter((r) => r.kind === "Secret").length, 0);
  }
});

test("staging har TLS-ingress og krypteret PVC", () => {
  const resources = resourcesFor("staging");
  const ingress = resources.find((r) => r.kind === "Ingress");
  assert.equal(ingress.spec.tls[0].secretName, "staging-platform-tls");
  const pvc = resources.find((r) => r.kind === "PersistentVolumeClaim");
  assert.equal(pvc.metadata.labels["platform.example.org/encrypted"], "true");
});
