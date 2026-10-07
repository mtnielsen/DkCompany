import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPlan } from "../src/render.mjs";
import { checkNetworkIsolation } from "../src/netpol.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resources = [...renderPlan(repoRoot).manifests.values()];

test("den genererede tilstand er isoleret", () => {
  assert.deepEqual(checkNetworkIsolation(resources), []);
});

test("en manglende default-deny opdages", () => {
  const mutated = resources.filter((r) => r.metadata?.name !== "default-deny");
  assert.ok(checkNetworkIsolation(mutated).some((p) => /default-deny/.test(p)));
});

test("en tom namespaceSelector opdages", () => {
  const mutated = resources.map((r) => (r.metadata?.name === "allow-internal" ? { ...r, spec: { ...r.spec, ingress: [{ from: [{ namespaceSelector: {} }] }] } } : r));
  assert.ok(checkNetworkIsolation(mutated).some((p) => /alle namespaces/.test(p)));
});

test("egress til et andet miljøs namespace opdages", () => {
  const mutated = resources.map((r) => (r.metadata?.name === "allow-internal" ? { ...r, spec: { ...r.spec, egress: [{ to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "platform-prod" } } }] }] } } : r));
  assert.ok(checkNetworkIsolation(mutated).some((p) => /andet miljøs namespace/.test(p)));
});

test("wildcard-IP opdages", () => {
  const mutated = resources.map((r) => (r.metadata?.name === "allow-dns" ? { ...r, spec: { ...r.spec, egress: [{ to: [{ ipBlock: { cidr: "0.0.0.0/0" } }] }] } } : r));
  assert.ok(checkNetworkIsolation(mutated).some((p) => /wildcard-IP/.test(p)));
});
