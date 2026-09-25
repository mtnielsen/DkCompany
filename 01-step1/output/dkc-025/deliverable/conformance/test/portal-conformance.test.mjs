import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateServicePackageDir,
  validateTenantLifecycleDir,
  validateCustomerOrderDir,
  validateTenantLifecycle,
  validateCustomerOrder,
  canonicalServicePackageProblems,
  customerOrderProblems,
} from "../src/portal.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const examplesDir = join(repoRoot, "contracts", "examples");

test("portalens kontrakteksempler validerer (skema + semantik)", () => {
  const packages = validateServicePackageDir(examplesDir);
  assert.equal(packages.length, 1);
  assert.equal(packages[0].ok, true, JSON.stringify(packages[0].errors));
  const lifecycles = validateTenantLifecycleDir(examplesDir);
  assert.equal(lifecycles.length, 1);
  assert.equal(lifecycles[0].ok, true, JSON.stringify(lifecycles[0].errors));
  const orders = validateCustomerOrderDir(examplesDir);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].ok, true, JSON.stringify(orders[0].errors));
});

test("de kanoniske servicepakker validerer", () => {
  assert.deepEqual(canonicalServicePackageProblems(repoRoot), []);
});

test("en ændret revisionshændelse afvises", () => {
  const record = JSON.parse(readFileSync(join(examplesDir, "tenant-lifecycle.example.json"), "utf8"));
  const tampered = structuredClone(record);
  tampered.auditTrail[1].type = "customer.magically-activated";
  const result = validateTenantLifecycle(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("/hash")));
});

test("en lukket kunde uden gennemført eksport/sletning afvises", () => {
  const record = JSON.parse(readFileSync(join(examplesDir, "tenant-lifecycle.example.json"), "utf8"));
  const broken = structuredClone(record);
  broken.windingDown.deletionCompleted = false;
  const result = validateTenantLifecycle(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === "/windingDown"));
});

test("en aktiv ordre med et åbent trin afvises", () => {
  const order = JSON.parse(readFileSync(join(examplesDir, "customer-order.example.json"), "utf8"));
  const broken = structuredClone(order);
  broken.steps[0].state = "pending";
  assert.ok(customerOrderProblems(broken).some((p) => p.path === "/state"));
});

test("en manglende kvittering for en væsentlig konsekvens afvises", () => {
  const order = JSON.parse(readFileSync(join(examplesDir, "customer-order.example.json"), "utf8"));
  const broken = structuredClone(order);
  broken.acknowledgedConsequences = [];
  assert.ok(customerOrderProblems(broken).some((p) => p.path === "/acknowledgedConsequences"));
});

test("en dobbelt idempotency-key i en ordre afvises", () => {
  const order = JSON.parse(readFileSync(join(examplesDir, "customer-order.example.json"), "utf8"));
  const broken = structuredClone(order);
  broken.steps[1].idempotencyKey = broken.steps[0].idempotencyKey;
  assert.ok(validateCustomerOrder(broken).errors.some((e) => e.path === "/steps/1/idempotencyKey"));
});
