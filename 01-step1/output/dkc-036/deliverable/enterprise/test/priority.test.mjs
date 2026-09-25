import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll } from "../src/model.mjs";
import { prioritizePackages, demandScore, packageTco } from "../src/priority.mjs";

const all = loadAll(repoRoot);

test("prioriteringen er deterministisk og dækker alle pakker", () => {
  const first = prioritizePackages(all.packages.packages, { pilotProfiles: all.pilotProfiles, tco: all.tco });
  const second = prioritizePackages([...all.packages.packages].reverse(), { pilotProfiles: all.pilotProfiles, tco: all.tco });
  assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id));
  assert.equal(first.length, all.packages.packages.length);
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(first[i - 1].priorityScore >= first[i].priorityScore);
  }
});

test("højere efterspørgsel giver højere score ved samme omkostning", () => {
  const retail = all.packages.packages.find((p) => p.id === "retail-commerce");
  const regulated = all.packages.packages.find((p) => p.id === "regulated-care");
  assert.ok(demandScore(retail, { pilotProfiles: all.pilotProfiles }) > demandScore(regulated, { pilotProfiles: all.pilotProfiles }));
});

test("omkostningen hentes fra den dokumenterede TCO-sammenligning", () => {
  const pkg = all.packages.packages.find((p) => p.id === "enterprise-core");
  const tco = packageTco(pkg, all.tco);
  assert.equal(tco.measured, false);
  assert.ok(tco.twelveMonthTco > 0);
  assert.equal(tco.profileId, "enterprise");
});

test("prioriteringen erklærer ingen målt besparelse", () => {
  const rows = prioritizePackages(all.packages.packages, { pilotProfiles: all.pilotProfiles, tco: all.tco });
  for (const row of rows) assert.equal(row.tco.measured, false);
});
