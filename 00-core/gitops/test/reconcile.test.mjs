import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, applyDrift, subsetEqual, keyOf } from "../src/reconcile.mjs";

const deployment = (name, replicas = 2) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name, namespace: "platform", labels: { "platform.example.org/module": name } },
  spec: { replicas },
});

const service = (name) => ({ apiVersion: "v1", kind: "Service", metadata: { name, namespace: "platform" }, spec: {} });

test("subsetEqual ignorerer felter som kun findes i klyngen", () => {
  const desired = { spec: { replicas: 2 } };
  const observed = { spec: { replicas: 2 }, status: { readyReplicas: 2 } };
  assert.equal(subsetEqual(desired, observed), true);
  assert.equal(subsetEqual(desired, { spec: { replicas: 3 } }), false);
});

test("identisk tilstand giver ingen handlinger", () => {
  const desired = [deployment("pdp"), service("pdp")];
  const result = reconcile(desired, structuredClone(desired));
  assert.equal(result.inSync, true);
  assert.equal(result.actions.length, 0);
});

test("manglende, ændret og ekstra ressource giver create/revert/delete", () => {
  const desired = [deployment("pdp"), service("pdp")];
  const observed = [deployment("pdp", 99), service("extra")];
  const result = reconcile(desired, observed);
  const ops = Object.fromEntries(result.actions.map((a) => [keyOf(a.resource), a.op]));
  assert.equal(ops["apps/v1/Deployment/platform/pdp"], "revert");
  assert.equal(ops["v1/Service/platform/pdp"], "create");
  assert.equal(ops["v1/Service/platform/extra"], "delete");
  assert.equal(result.inSync, false);
});

test("applyDrift reproducerer den simulerede drift", () => {
  const desired = [deployment("pdp"), service("dummy-ok")];
  const spec = {
    changes: [
      { op: "set", resource: { apiVersion: "apps/v1", kind: "Deployment", namespace: "platform", name: "pdp" }, path: "spec.replicas", value: 99 },
      { op: "add", resource: { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "hotfix", namespace: "platform" } } },
      { op: "delete", resource: { apiVersion: "v1", kind: "Service", namespace: "platform", name: "dummy-ok" } },
    ],
  };
  const observed = applyDrift(desired, spec);
  assert.equal(observed.length, 2);
  assert.equal(observed.find((r) => r.kind === "Deployment").spec.replicas, 99);

  const result = reconcile(desired, observed);
  assert.ok(result.actions.some((a) => a.op === "revert"));
  assert.ok(result.actions.some((a) => a.op === "create"));
  assert.ok(result.actions.some((a) => a.op === "delete"));
});
