import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  indexCatalog,
  affectedServices,
  ownerForService,
  rotationForService,
  currentOnCall,
  escalationChain,
  escalationTarget,
  ackDeadlineMinutes,
  slaCoversAllSeverities,
} from "../src/catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const catalog = JSON.parse(readFileSync(join(repoRoot, "service-registry", "services.json"), "utf8"));
const rotations = JSON.parse(readFileSync(join(repoRoot, "service-registry", "oncall.json"), "utf8"));

test("kataloget indekserer tjenesterne", () => {
  const { services, byId } = indexCatalog(catalog);
  assert.equal(services.length, 5);
  assert.equal(byId.get("checkout").name, "Checkout");
});

test("berørte tjenester er transitive", () => {
  assert.deepEqual(affectedServices(catalog, "checkout"), ["checkout", "identity", "database", "notifications"]);
  assert.deepEqual(affectedServices(catalog, "database"), ["database"]);
  assert.deepEqual(affectedServices(catalog, "ukendt"), []);
});

test("ejer og on-call er navngivne mennesker", () => {
  assert.equal(ownerForService(catalog, "checkout").subject, "oidc|maja.mortensen");
  const rotation = rotationForService(rotations, "checkout");
  assert.equal(currentOnCall(rotation).subject, "oidc|bo.bertelsen");
  assert.equal(currentOnCall(rotation).name, "Bo Bertelsen");
});

test("eskalationskæden er stigende og ender hos et menneske", () => {
  const rotation = rotationForService(rotations, "checkout");
  const chain = escalationChain(rotation);
  assert.equal(chain.length, 3);
  assert.equal(chain[0].subject, "oidc|bo.bertelsen");
  assert.equal(chain[1].subject, "oidc|maja.mortensen");
  assert.equal(escalationTarget(rotation, 0).subject, "oidc|bo.bertelsen");
  assert.equal(escalationTarget(rotation, 15).subject, "oidc|maja.mortensen");
  assert.equal(escalationTarget(rotation, 45).subject, "oidc|anna.andersen");
});

test("kvitteringsfristen kommer fra SLA'ens svartid", () => {
  const rotation = rotationForService(rotations, "checkout");
  assert.equal(ackDeadlineMinutes(catalog, rotation, "sev1"), 5);
  assert.equal(ackDeadlineMinutes(catalog, rotation, "sev2"), 15);
  assert.equal(ackDeadlineMinutes(catalog, rotation, "sev3"), 60);
});

test("SLA dækker alle alvorlighedsgrader", () => {
  for (const service of catalog.services) {
    assert.equal(slaCoversAllSeverities(service.sla), true, service.id);
  }
  assert.equal(slaCoversAllSeverities([{ severity: "sev1" }]), false);
});
