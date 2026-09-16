import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { findProblems, renderMarkdown } from "../src/render.mjs";
import { loadMapping, outputPath, check } from "../src/cli.mjs";

test("control-mapping.json validerer mod kontrakten og er internt konsistent", () => {
  const mapping = loadMapping();
  const { ajv } = buildAjv();
  const { ok, errors } = validate(ajv, SCHEMA_IDS.controlMapping, mapping);
  assert.equal(ok, true, errors.map((e) => `${e.path} ${e.message}`).join("\n"));
  assert.deepEqual(findProblems(mapping), []);
});

test("findProblems fanger ukendte krav og dubletter", () => {
  const problems = findProblems({
    frameworks: [
      { id: "nis2", requirements: [{ id: "nis2-art21-2i" }, { id: "nis2-art21-2i" }] },
      { id: "nis2", requirements: [{ id: "gdpr-art32" }] },
    ],
    controls: [
      { id: "ac-2", satisfies: ["findes-ikke"], evidence: ["C-005"] },
      { id: "ac-2", satisfies: ["gdpr-art32"], evidence: ["C-005"] },
    ],
  });
  assert.ok(problems.some((p) => p.includes("framework 'nis2' er angivet flere gange")));
  assert.ok(problems.some((p) => p.includes("krav 'nis2-art21-2i' er angivet flere gange")));
  assert.ok(problems.some((p) => p.includes("peger på ukendt krav 'findes-ikke'")));
  assert.ok(problems.some((p) => p.includes("kontrol 'ac-2' er angivet flere gange")));
});

test("renderMarkdown er deterministisk og dækker alle kontroller og frameworks", () => {
  const mapping = loadMapping();
  const md = renderMarkdown(mapping);
  assert.equal(md, renderMarkdown(mapping));
  for (const control of mapping.controls) assert.ok(md.includes(`\`${control.id}\``), `mangler kontrol ${control.id}`);
  for (const framework of mapping.frameworks) assert.ok(md.includes(framework.name), `mangler framework ${framework.name}`);
  assert.match(md, /udgiver og deployer/i);
  assert.ok(md.endsWith("\n"));
});

test("docs/compliance/mapping.md er i trit med registry", () => {
  assert.doesNotThrow(() => check());
  assert.equal(readFileSync(outputPath, "utf8"), renderMarkdown(loadMapping()));
});
