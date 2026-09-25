/**
 * DKC-019 — konformanstests for dataregister og retention.
 *
 * Beviser på de faktiske datafiler at hvert pilotmodul og hver modelroute har
 * en godkendt registerpost med en navngivet ejer, at uafklarede persondataposter
 * markeres som blocker i stedet for at passere, og at tredjelandsvurderingen er
 * eksplicit, også når data hostes i EU/EEA.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { validateDataRegisterDir, dataRegisterProblems, entryBlockers } from "../src/data-register.mjs";
import { loadRegister, checkRepoReferences, blockerRows, renderMarkdown } from "../../compliance/src/data-register.mjs";

const examplesDir = join(import.meta.dirname, "..", "..", "contracts", "examples");

test("dataregister-eksemplet validerer mod skema + semantik", () => {
  const results = validateDataRegisterDir(examplesDir);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true, results[0].errors.map((e) => `${e.path} ${e.message}`).join("\n"));
});

test("hvert pilotmodul og hver modelroute har en godkendt registerpost med navngivet ejer", () => {
  const register = loadRegister();
  assert.deepEqual(checkRepoReferences(register), []);
  for (const entry of register.entries) {
    assert.ok(entry.owner?.name, `${entry.id} mangler ejernavn`);
    assert.equal(entry.status, "approved", `${entry.id} er ikke godkendt`);
  }
  assert.ok(register.entries.some((e) => e.moduleRef));
  assert.ok(register.entries.some((e) => e.routeRef));
});

test("en uafklaret persondatapost markeres som blocker — den opfindes ikke", () => {
  const register = loadRegister();
  const entry = register.entries.find((e) => e.id === "dummy-ok");
  const mutated = JSON.parse(JSON.stringify(entry));
  mutated.status = "approved";
  mutated.legalBasis = { status: "pending-owner-decision", ground: null, decidedBy: null, decidedAt: null, note: "Afventer ejer" };
  mutated.roles.processor = null;
  const blockers = entryBlockers(mutated);
  assert.ok(blockers.length >= 2);
  const problems = dataRegisterProblems({ ...register, entries: [mutated] });
  assert.ok(problems.some((p) => p.message.includes("kan ikke være 'approved'")));
  assert.equal(blockerRows({ entries: [mutated] }).length, 1);
});

test("EU-hosting er ikke automatisk fravær af tredjelandsoverførsel", () => {
  const register = loadRegister();
  for (const entry of register.entries) {
    assert.equal(entry.location.thirdCountryTransfer.assessed, true, `${entry.id} mangler en eksplicit vurdering`);
    assert.ok(entry.location.thirdCountryTransfer.assessedBy?.name, `${entry.id} mangler vurderingsansvarlig`);
  }
  const mutated = JSON.parse(JSON.stringify(register.entries[0]));
  delete mutated.location.thirdCountryTransfer;
  const problems = dataRegisterProblems({ ...register, entries: [mutated] });
  assert.ok(problems.some((p) => p.path.includes("thirdCountryTransfer")));
  assert.match(renderMarkdown(register), /Tredjeland/);
});
