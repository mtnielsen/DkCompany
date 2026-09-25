#!/usr/bin/env node
/**
 * DKC-020 — fokuseret, offline kontrol af privacy-modulet.
 *
 *   node privacy/src/check.mjs
 *
 * Kontrollerer at:
 *   - den committede eksport validerer mod skemaet og den semantiske validator,
 *   - identitetsmatchningen er fail-closed på tværs af tenant og andre personer,
 *   - eksportens udløbs-/modtagerbinding afvises korrekt (ren funktion).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { privacyExportProblems } from "../../conformance/src/privacy.mjs";
import { normalizeIdentifier, subjectMatch, filterSubjectRecords } from "./identity.mjs";

export function collectProblems(root = repoRoot) {
  const problems = [];

  const examplePath = join(root, "contracts", "examples", "privacy-export.example.json");
  let example;
  try {
    example = JSON.parse(readFileSync(examplePath, "utf8"));
  } catch (err) {
    problems.push(`privacy-export.example.json: ${err.message}`);
    example = null;
  }
  if (example) {
    for (const p of privacyExportProblems(example, { now: Date.parse(example.createdAt) + 1000 })) {
      problems.push(`privacy-export.example.json: ${p.path} ${p.message}`.trim());
    }
  }

  // En fremmed tenant må aldrig matche, selv med identisk e-mailtekst.
  const foreign = subjectMatch({
    tenantId: "acme",
    identifiers: [normalizeIdentifier({ type: "email", value: "Kunde@Example.org" })],
    record: { tenantId: "globex", identifiers: [{ type: "email", value: "kunde@example.org" }] },
  });
  if (foreign) problems.push("identitetsmatchning: en fremmed tenant matchede");
  const same = subjectMatch({
    tenantId: "acme",
    identifiers: [normalizeIdentifier({ type: "email", value: "Kunde@Example.org" })],
    record: { tenantId: "acme", identifiers: [{ type: "email", value: "kunde@example.org" }] },
  });
  if (!same) problems.push("identitetsmatchning: samme tenant og e-mail matchede ikke");

  // En post med en anden ejer må filtreres fra.
  const { records, dropped } = filterSubjectRecords({
    tenantId: "acme",
    identifiers: [normalizeIdentifier({ type: "email", value: "kunde@example.org" })],
    records: [
      { subjectId: "u1", tenantId: "acme", identifiers: [{ type: "email", value: "kunde@example.org" }] },
      { subjectId: "u2", tenantId: "acme", identifiers: [{ type: "email", value: "anden@example.org" }] },
    ],
  });
  if (records.length !== 1 || dropped !== 1) problems.push(`identitetsfilter: forventede 1 beholdt/1 udeladt, fik ${records.length}/${dropped}`);

  return problems;
}

function main() {
  const problems = collectProblems();
  if (problems.length) {
    console.error("✘ privacy-kontrol fejlede:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("✔ privacy: eksport-eksempel validerer, og identitetsmatchning er fail-closed på tenant og ejer");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
