/**
 * DKC-019 — dataregisterets kontrakt, semantik, krydsreferencer og driftstest.
 *
 * Beviser at:
 *   - det kanoniske register validerer og krydsrefererer mod rigtige moduler og
 *     routes,
 *   - ugyldig retention/ejerskab og en uafklaret persondatapost fanges,
 *   - EU-hosting ikke automatisk bliver "ingen tredjelandsoverførsel",
 *   - det genererede dokument er i trit med registeret.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegister, renderMarkdown, check, checkRepoReferences, blockerRows, outputPath, registerPath } from "../src/data-register.mjs";
import { dataRegisterProblems, entryBlockers, validateDataRegister } from "../../conformance/src/data-register.mjs";

const examplePath = join(import.meta.dirname, "..", "..", "contracts", "examples", "data-register.example.json");
const example = () => JSON.parse(readFileSync(examplePath, "utf8"));

test("det kanoniske register validerer og krydsrefererer mod moduler og routes", () => {
  const register = loadRegister();
  assert.deepEqual(checkRepoReferences(register), []);
  assert.deepEqual(blockerRows(register), []);
});

test("eksemplet validerer mod skema og semantik", () => {
  const result = validateDataRegister(example());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("findProblems fanger manglende ejer, formål og uafklaret beslutning", () => {
  const register = example();
  register.entries[0].owner = { subject: "group|team", name: "Team", role: "Group" };
  register.entries[0].retention.purposeRef = "findes-ikke";
  register.entries[1].status = "approved";
  register.entries[1].dataCategories = ["personal"];
  register.entries[1].legalBasis = { status: "pending-owner-decision", ground: null, decidedBy: null, decidedAt: null };
  register.entries[1].roles.controller = null;
  register.entries[1].location.thirdCountryTransfer = { assessed: false, status: "undetermined", mechanisms: [], assessedBy: null, assessedAt: null };
  const problems = dataRegisterProblems(register);
  const text = problems.map((p) => `${p.path} ${p.message}`).join("\n");
  assert.match(text, /navngivet menneske som ejer/);
  assert.match(text, /peger på formålet 'findes-ikke'/);
  assert.match(text, /behandlingsgrundlaget er ikke ejerbesluttet|ikke 'approved'/);
  assert.match(text, /tredjeland/);
});

test("EU-hosting er ikke i sig selv fravær af tredjelandsoverførsel", () => {
  const register = example();
  const entry = register.entries.find((e) => e.id === "example-assistant");
  entry.location.hostingRegion = "eu-eea";
  delete entry.location.thirdCountryTransfer;
  const problems = dataRegisterProblems(register);
  assert.ok(problems.some((p) => p.path.includes("thirdCountryTransfer")), "en manglende vurdering skal fanges trods EU-hosting");
});

test("entryBlockers kræver ejerbeslutning, aftale, tredjelandsvurdering og artefakter", () => {
  const entry = example().entries.find((e) => e.id === "example-assistant");
  entry.legalBasis = { status: "pending-owner-decision", ground: null, decidedBy: null, decidedAt: null };
  entry.roles.processor = null;
  entry.location.thirdCountryTransfer = { assessed: false, status: "undetermined", mechanisms: [] };
  const blockers = entryBlockers(entry);
  assert.ok(blockers.length >= 3);
  assert.ok(blockers.some((b) => b.includes("behandlingsgrundlaget")));
  assert.ok(blockers.some((b) => b.includes("processor-aftale")));
  assert.ok(blockers.some((b) => b.includes("tredjelandsoverførslen")));
});

test("krydsreference fanger manglende modul- og routedækning", () => {
  const register = example();
  register.entries = register.entries.filter((e) => e.moduleRef !== "example-module");
  const problems = checkRepoReferences(register, {
    modules: [{ name: "example-module", manifest: { metadata: { accountableHuman: { subject: "oidc|anna.andersen" } } } }],
    routes: [{ id: "example-route", dataClasses: ["personal"], approvedDataProcessing: true, processor: "anthropic-eu", dpaRef: "dpa://x" }],
  });
  assert.ok(problems.some((p) => p.includes("example-module") && p.includes("ingen registerpost")));
  assert.ok(problems.some((p) => p.includes("example-route") && p.includes("ingen registerpost")));
});

test("renderMarkdown er deterministisk og dækker alle poster", () => {
  const register = loadRegister();
  const md = renderMarkdown(register);
  assert.equal(md, renderMarkdown(register));
  for (const entry of register.entries) assert.ok(md.includes(`\`${entry.id}\``), `mangler ${entry.id}`);
  assert.match(md, /Blockere/);
  assert.match(md, /Retention pr. formål/);
});

test("docs/compliance/data-register.md er i trit med registeret", () => {
  assert.doesNotThrow(() => check());
  assert.equal(readFileSync(outputPath, "utf8"), renderMarkdown(loadRegister()));
  assert.ok(registerPath.endsWith("compliance/data-register.json"));
});
