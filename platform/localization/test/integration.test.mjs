import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents } from "../../distribution/src/catalog.mjs";
import { loadAll } from "../src/model.mjs";
import { resolveFamilyComponents, checkAdapterInterface } from "../src/integration.mjs";
import { runLocalizationCheck } from "../src/check.mjs";

const all = loadAll(repoRoot);
const components = loadComponents();
const byName = new Map(components.map((c) => [c.data.metadata.name, c.data]));

test("hver familie løses gennem den faktiske dependency-resolver", () => {
  for (const family of all.families.families) {
    const result = resolveFamilyComponents(family);
    assert.equal(result.ok, true, `${family.id}: ${JSON.stringify(result.errors)}`);
    for (const component of family.components) assert.ok(result.closure.includes(component), `${family.id} mangler ${component}`);
    assert.ok(result.dataServices.includes("sql|relational"), `${family.id} mangler sql-provider`);
  }
});

test("adaptergrænsefladerne dækker modulets driftsverber og dataklasser", () => {
  for (const family of all.families.families) {
    const manifest = byName.get(family.components[0]);
    const iface = all.interfaces.interfaces.find((i) => i.id === family.adapterInterface);
    assert.equal(checkAdapterInterface(iface, manifest).length, 0, family.id);
  }
});

test("en manglende driftsverbum i adaptergrænsefladen afvises", () => {
  const manifest = byName.get("finance");
  const iface = JSON.parse(JSON.stringify(all.interfaces.interfaces.find((i) => i.id === "finance-ledger")));
  iface.verbs = iface.verbs.filter((v) => v !== "backup");
  assert.ok(checkAdapterInterface(iface, manifest).some((p) => /backup/.test(p)));
});

test("den fulde deterministiske kontrol består, og rapporten er i trit", () => {
  const result = runLocalizationCheck(repoRoot);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const onDisk = JSON.parse(readFileSync(join(repoRoot, "localization", "report", "localization-report.json"), "utf8"));
  assert.equal(onDisk.summary.danishReady, 0);
  assert.equal(onDisk.summary.coverage.full, 0);
});
