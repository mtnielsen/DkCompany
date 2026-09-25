import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlan } from "../src/plan.mjs";
import { renderPlan } from "../src/render.mjs";
import { checkSecretInjection } from "../src/secrets.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const plan = loadPlan(repoRoot);
const resources = [...renderPlan(repoRoot).manifests.values()];

test("renderede manifester bruger kun deklarerede secret-referencer", () => {
  assert.deepEqual(checkSecretInjection(plan, resources), []);
});

test("et committet Secret-objekt afvises", () => {
  const problems = checkSecretInjection(plan, [...resources, { kind: "Secret", metadata: { name: "x", namespace: "platform-staging" }, data: {} }]);
  assert.ok(problems.some((p) => /Secret-objekt/.test(p)));
});

test("en udeklareret secret-reference afvises", () => {
  const mutated = resources.map((r) => (r.kind === "Deployment" && r.metadata.name === "pdp" ? { ...r, spec: { ...r.spec, template: { ...r.spec.template, spec: { ...r.spec.template.spec, containers: [{ ...r.spec.template.spec.containers[0], envFrom: [{ secretRef: { name: "ikke-deklareret" } }] }] } } } } : r));
  assert.ok(checkSecretInjection(plan, mutated).some((p) => /ikke deklareret/.test(p)));
});

test("klartekst-hemmelighed i et manifest afvises", () => {
  const problems = checkSecretInjection(plan, [...resources, { kind: "ConfigMap", metadata: { name: "x", namespace: "platform-staging" }, data: { password: "hunter2" } }]);
  assert.ok(problems.some((p) => /klartekst/.test(p)));
});
