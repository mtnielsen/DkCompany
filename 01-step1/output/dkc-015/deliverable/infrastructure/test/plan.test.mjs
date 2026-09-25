import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlan, environmentById, environmentIds, REQUIRED_SERVICES, RENDERED_ENVIRONMENTS } from "../src/plan.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("planen erklærer dev, staging og prod", () => {
  const plan = loadPlan(repoRoot);
  assert.deepEqual(environmentIds(plan).sort(), ["dev", "prod", "staging"]);
  assert.deepEqual(RENDERED_ENVIRONMENTS, ["staging", "prod"]);
});

test("hvert miljø har de obligatoriske kontroltjenester", () => {
  const plan = loadPlan(repoRoot);
  for (const env of plan.environments) {
    const names = new Set(env.services.map((s) => s.name));
    for (const required of REQUIRED_SERVICES) assert.ok(names.has(required), `${env.id} mangler ${required}`);
  }
});

test("staging er namespace-isoleret og prod er klynge-isoleret", () => {
  const plan = loadPlan(repoRoot);
  assert.equal(environmentById(plan, "staging").isolation, "namespace");
  assert.equal(environmentById(plan, "prod").isolation, "cluster");
  const namespaces = plan.environments.map((e) => e.namespace);
  assert.equal(new Set(namespaces).size, namespaces.length);
});
