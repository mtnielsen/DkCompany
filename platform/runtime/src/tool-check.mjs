#!/usr/bin/env node
/**
 * DKC-011 — `make tool-boundary-check`.
 *
 * Deterministisk kontrol af værktøjsgrænsen og angrebskorpuset:
 *   - værktøjsallowlisten er entydig og indeholder ingen shell-/secret-verber,
 *   - hvert værktøj har et objekt-typeskema, en størrelsesgrænse og en
 *     konsistent egress-politik,
 *   - egress-allowlister er velformede, og netværksløse værktøjer har ingen,
 *   - angrebskorpuset dækker dansk, engelsk, kodede og indirekte instruktioner
 *     fra logs, dokumenter, mails, tool-output og model-output,
 *   - hvert korpustilfælde klassificeres som forventet af scanneren.
 *
 * Regex/decoding er kun et signal. Checken beviser at signalet er dækkende og
 * at grænsen er konsistent — ikke at den erstatter runtimevalideringen.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FORBIDDEN_VERB_PATTERN,
  SECRET_FETCH_PATTERN,
  TOOL_REGISTRY,
} from "./tools.mjs";
import { INJECTION_CATEGORIES, scanUntrusted } from "./injection.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(here, "..", "test", "fixtures", "injection-corpus.json");

const problems = [];
const push = (msg) => problems.push(msg);

function main() {
  validateRegistry();
  validateCorpus();
  if (problems.length) {
    console.error("✘ Værktøjsgrænse-check fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ ${TOOL_REGISTRY.length} typede værktøjer på allowlisten`);
  console.log(`✔ ${TOOL_REGISTRY.reduce((n, t) => n + t.verbs.length, 0)} verber er bundet til et typet værktøj`);
  console.log(`✔ ${INJECTION_CATEGORIES.length} injektionskategorier; angrebskorpus dækker sprog, kodninger og vektorer`);
  console.log("✔ Værktøjsgrænse og angrebskorpus er konsistente");
}

function validateRegistry() {
  const names = new Set();
  for (const tool of TOOL_REGISTRY) {
    if (!tool.name || names.has(tool.name)) push(`værktøjsnavnet '${tool.name}' mangler eller er ikke entydigt`);
    names.add(tool.name);
    if (!Array.isArray(tool.verbs) || tool.verbs.length === 0) push(`${tool.name}: verbs skal være en ikke-tom liste`);
    for (const verb of tool.verbs) {
      if (FORBIDDEN_VERB_PATTERN.test(verb)) push(`${tool.name}: shell-/eval-verbet '${verb}' må ikke være på allowlisten`);
      if (SECRET_FETCH_PATTERN.test(verb)) push(`${tool.name}: secret-hentende verbet '${verb}' må ikke være på allowlisten`);
    }
    if (!tool.params || tool.params.type !== "object") push(`${tool.name}: params skal være et objekt-typeskema`);
    if (!Number.isInteger(tool.maxInputBytes) || tool.maxInputBytes <= 0) push(`${tool.name}: maxInputBytes mangler`);
    const egress = tool.egress ?? {};
    if (egress.network === true) {
      if (!Array.isArray(egress.allowedHosts) || egress.allowedHosts.length === 0) push(`${tool.name}: netværksværktøj mangler allowedHosts`);
      if (!Array.isArray(egress.allowedSchemes) || egress.allowedSchemes.length === 0) push(`${tool.name}: netværksværktøj mangler allowedSchemes`);
    } else if (Array.isArray(egress.allowedHosts) && egress.allowedHosts.length > 0) {
      push(`${tool.name}: netværksløst værktøj må ikke have allowedHosts`);
    }
    for (const host of egress.allowedHosts ?? []) {
      if (!/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) push(`${tool.name}: ugyldig egress-vært '${host}'`);
      if (/^(localhost|127\.|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(host)) push(`${tool.name}: privat/metadata-vært '${host}' må ikke stå på allowlisten`);
    }
  }
}

function validateCorpus() {
  let corpus;
  try {
    corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  } catch (err) {
    push(`angrebskorpus kunne ikke læses: ${err.message}`);
    return;
  }
  const cases = corpus.cases ?? [];
  if (cases.length < 20) push(`angrebskorpus skal have mindst 20 tilfælde (har ${cases.length})`);
  const languages = new Set();
  const vectors = new Set();
  const encodings = new Set();
  const categories = new Set();
  const ids = new Set();
  for (const c of cases) {
    if (!c.id || ids.has(c.id)) push(`korpustilfælde mangler id eller har dublet-id '${c.id}'`);
    ids.add(c.id);
    if (!["flagged", "benign"].includes(c.expect)) push(`${c.id}: ukendt expect '${c.expect}'`);
    languages.add(c.language);
    vectors.add(c.vector);
    encodings.add(c.encoding);
    if (c.expect === "flagged" && !INJECTION_CATEGORIES.includes(c.category)) push(`${c.id}: ukendt kategori '${c.category}'`);
    if (c.expect === "flagged") categories.add(c.category);
    const scan = scanUntrusted(c.text);
    if (c.expect === "flagged" && !scan.flagged) push(`${c.id}: skulle være flagget men var ikke`);
    if (c.expect === "benign" && scan.flagged) push(`${c.id}: skulle være harmløst men blev flagget som ${scan.findings.join(",")}`);
  }
  for (const lang of ["da", "en", "encoded"]) if (!languages.has(lang)) push(`angrebskorpus mangler sproget '${lang}'`);
  for (const vector of ["log", "document", "email", "tool-output", "model-output"]) if (!vectors.has(vector)) push(`angrebskorpus mangler vektoren '${vector}'`);
  for (const encoding of ["plain", "base64", "hex", "rot13", "unicode"]) if (!encodings.has(encoding)) push(`angrebskorpus mangler kodningen '${encoding}'`);
  for (const category of ["ignore-instructions", "role-override", "autonomy-change", "secret-exfiltration", "shell-execution", "cross-tenant"]) {
    if (!categories.has(category)) push(`angrebskorpus mangler kategori '${category}'`);
  }
}

main();
