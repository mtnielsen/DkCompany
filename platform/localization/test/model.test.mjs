import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents } from "../../distribution/src/catalog.mjs";
import {
  loadAll,
  loadFamilies,
  loadLocaleRequirements,
  loadAdapterInterfaces,
  localeRequirementProblems,
  adapterInterfaceProblems,
  familyCatalogProblems,
  componentLocalizationProblems,
  deriveFamilyStatus,
} from "../src/model.mjs";

const exampleFiles = readdirSync(join(repoRoot, "contracts", "examples"));
const components = loadComponents();
const all = loadAll(repoRoot);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("de kanoniske lokaliseringskataloger er semantisk konsistente", () => {
  assert.equal(localeRequirementProblems(loadLocaleRequirements(repoRoot)).length, 0);
  assert.equal(adapterInterfaceProblems(loadAdapterInterfaces(repoRoot)).length, 0);
  const problems = familyCatalogProblems(loadFamilies(repoRoot), {
    components,
    requirements: all.requirements,
    interfaces: all.interfaces,
    exampleFiles,
  });
  assert.equal(problems.length, 0, JSON.stringify(problems));
});

test("hver katalogkomponents localization-blok peger på noget, der findes", () => {
  const withLocalization = components.filter((c) => c.data.localization);
  assert.ok(withLocalization.length >= 6, "der skal være mindst seks registrerede forretningskomponenter");
  for (const entry of withLocalization) {
    const problems = componentLocalizationProblems(entry.data, {
      families: all.families,
      requirements: all.requirements,
      interfaces: all.interfaces,
      exampleFiles,
    });
    assert.equal(problems.length, 0, `${entry.file}: ${JSON.stringify(problems)}`);
  }
});

test("rækkefølgen er unik og familierne har præcis én valgt kandidat", () => {
  const orders = all.families.families.map((f) => f.order);
  assert.equal(new Set(orders).size, orders.length);
  for (const family of all.families.families) {
    assert.equal(family.candidateProducts.filter((c) => c.selected).length, 1, family.id);
  }
});

test("bogføring og løn udleder 'pending-legal-review'", () => {
  const finance = all.families.families.find((f) => f.id === "finance");
  const hr = all.families.families.find((f) => f.id === "hr");
  assert.equal(deriveFamilyStatus(finance, all.requirements.requirements, all.interfaces.interfaces), "pending-legal-review");
  assert.equal(deriveFamilyStatus(hr, all.requirements.requirements, all.interfaces.interfaces), "pending-legal-review");
});

test("tid udleder 'registered' fordi ingen blokerende krav gælder", () => {
  const time = all.families.families.find((f) => f.id === "time");
  assert.equal(deriveFamilyStatus(time, all.requirements.requirements, all.interfaces.interfaces), "registered");
});

test("en familie med en forkert udledt status afvises", () => {
  const broken = clone(all.families);
  broken.families.find((f) => f.id === "finance").familyStatus = "registered";
  const problems = familyCatalogProblems(broken, { components, requirements: all.requirements, interfaces: all.interfaces, exampleFiles });
  assert.ok(problems.some((p) => p.path.endsWith("/familyStatus")));
});

test("en komponent der peger på et ukendt lokaliseringskrav afvises", () => {
  const manifest = clone(components.find((c) => c.data.metadata.name === "finance").data);
  manifest.localization.localeRequirements.push("ukendt-krav");
  const problems = componentLocalizationProblems(manifest, { families: all.families, requirements: all.requirements, interfaces: all.interfaces, exampleFiles });
  assert.ok(problems.some((p) => p.path === "/localization/localeRequirements"));
});

test("et ukendt adapterinterface afvises", () => {
  const broken = clone(all.interfaces);
  broken.interfaces[0].family = "ukendt";
  assert.ok(adapterInterfaceProblems(broken).some((p) => p.path.endsWith("/family")));
});

test("et betalingsscope med fuld bankadgang afvises", () => {
  const broken = clone(all.interfaces);
  broken.interfaces.find((i) => i.id === "payment-bank").scopes.push({ id: "bank:full-access", access: "write", description: "Fuld bankadgang." });
  assert.ok(adapterInterfaceProblems(broken).some((p) => p.path.endsWith("/scopes")));
});
