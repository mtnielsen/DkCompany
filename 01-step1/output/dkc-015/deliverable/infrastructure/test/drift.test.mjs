import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectDrift, kubectlAvailable } from "../src/drift.mjs";
import { loadManifests } from "../../gitops/src/verify.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("en observeret tilstand der matcher git giver in-sync", () => {
  const desired = loadManifests(repoRoot, "staging").map((m) => m.data);
  const result = detectDrift(repoRoot, "staging", { observed: structuredClone(desired) });
  assert.equal(result.status, "in-sync");
  assert.equal(result.source, "injected-observed-state");
});

test("en ekstra ressource uden om git opdages som drift", () => {
  const desired = loadManifests(repoRoot, "staging").map((m) => m.data);
  const observed = structuredClone(desired);
  observed.push({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "hotfix", namespace: "platform-staging" } });
  const result = detectDrift(repoRoot, "staging", { observed });
  assert.equal(result.status, "drift");
  assert.ok(result.actions.some((a) => a.op === "delete"));
});

test("en ændret replicas-værdi føres tilbage", () => {
  const desired = loadManifests(repoRoot, "staging").map((m) => m.data);
  const observed = structuredClone(desired);
  const deployment = observed.find((r) => r.kind === "Deployment");
  deployment.spec.replicas = 99;
  const result = detectDrift(repoRoot, "staging", { observed });
  assert.equal(result.status, "drift");
  assert.ok(result.actions.some((a) => a.op === "revert"));
});

test("uden kubectl er rigtig drift NOT RUN, ikke grøn", () => {
  if (kubectlAvailable().available) return; // miljøet har kubectl; spring over
  const result = detectDrift(repoRoot, "staging");
  assert.equal(result.status, "not-run");
  assert.match(result.reason, /kubectl/);
});
