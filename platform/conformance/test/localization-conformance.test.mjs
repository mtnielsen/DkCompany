/**
 * DKC-035 — konformanstest for modulregistreringen.
 *
 * Tester skema + semantik på de faktiske familier, lokaliseringskrav,
 * adaptergrænseflader, katalogkomponenter, eksempler og den genererede rapport,
 * og at et brud afvises (forkert udledt status, ukendt krav, forbudt
 * betalingsscope og en rapport der erklærer danskklar på et uafklaret grundlag).
 * En faktisk adapter og en godkendt betalingstjeneste er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { loadComponents } from "../../distribution/src/catalog.mjs";
import { validateModuleFamilies, validateLocaleRequirements, validateAdapterInterfaces, validateComponentLocalization, validateModuleRegistrationReport } from "../src/localization.mjs";
import { loadAll } from "../../localization/src/model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const all = loadAll(repoRoot);
const components = loadComponents();
const exampleFiles = new Set(readdirSync(join(repoRoot, "contracts", "examples")));
const context = { components, requirements: all.requirements, interfaces: all.interfaces, exampleFiles };

test("det faktiske familiekatalog validerer mod skema og semantik", () => {
  assert.equal(validateModuleFamilies(all.families, undefined, context).ok, true);
});

test("de faktiske lokaliseringskrav og adaptergrænseflader validerer", () => {
  assert.equal(validateLocaleRequirements(all.requirements).ok, true);
  assert.equal(validateAdapterInterfaces(all.interfaces).ok, true);
});

test("hver katalogkomponents localization-blok validerer", () => {
  const withLocalization = components.filter((c) => c.data.localization);
  assert.ok(withLocalization.length >= 6);
  for (const entry of withLocalization) {
    assert.equal(validateComponentLocalization(entry.data, context).ok, true, entry.file);
  }
});

test("eksemplerne validerer", () => {
  assert.equal(validateModuleFamilies(read("contracts/examples/module-family.example.json"), undefined, context).ok, true);
  assert.equal(validateLocaleRequirements(read("contracts/examples/locale-requirement.example.json")).ok, true);
  assert.equal(validateAdapterInterfaces(read("contracts/examples/adapter-interface.example.json")).ok, true);
});

test("den genererede rapport validerer og erklærer ingen danskklar familie", () => {
  const report = read("localization/report/localization-report.json");
  assert.equal(validateModuleRegistrationReport(report).ok, true);
  assert.equal(report.measured, false);
  assert.equal(report.summary.danishReady, 0);
  for (const family of report.families) assert.equal(family.danishReady, false, family.id);
});

test("en familie med forkert udledt status afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.families));
  broken.families.find((f) => f.id === "finance").familyStatus = "registered";
  assert.ok(validateModuleFamilies(broken, undefined, context).errors.length > 0);
});

test("en komponent der erklærer et ugyldigt lokaliseringskrav afvises", () => {
  const manifest = JSON.parse(JSON.stringify(components.find((c) => c.data.metadata.name === "finance").data));
  manifest.localization.localeRequirements.push("ukendt-krav");
  assert.ok(validateComponentLocalization(manifest, context).errors.length > 0);
});

test("en adaptergrænseflade med fuld bankadgang afvises", () => {
  const broken = JSON.parse(JSON.stringify(all.interfaces));
  broken.interfaces.find((i) => i.id === "payment-bank").scopes.push({ id: "cards:read", access: "read", description: "Kortdata." });
  assert.ok(validateAdapterInterfaces(broken).errors.length > 0);
});

test("en rapport der erklærer danskklar med afventende gates afvises", () => {
  const report = read("localization/report/localization-report.json");
  const broken = JSON.parse(JSON.stringify(report));
  broken.families[0].danishReady = true;
  broken.summary.danishReady = 1;
  assert.ok(validateModuleRegistrationReport(broken).errors.length > 0);
});
