#!/usr/bin/env node
/**
 * DKC-021 — fokuseret kontrol af slette- og tilbageholdelsesreglerne.
 *
 *   node retention/src/check.mjs
 *
 * Kontrollerer uden et levende miljø at:
 *   - politikken validerer mod kontrakten og de semantiske regler,
 *   - det committede eksempel er identisk med den kanoniske politik,
 *   - dækningsdokumentet er i trit,
 *   - semantikken afviser brud (manglende datalag, slået regel fra, AI-adgang,
 *     hold uden separat godkender),
 *   - et fuldt gennemløb på den rigtige stak rapporterer hold-blokering,
 *     ærlig partial og genanvendelse af slettebeslutninger ved restore.
 */
import { readFileSync } from "node:fs";
import { loadPolicy, loadCommittedExample, outputPath } from "./registry.mjs";
import { validateDeletionPolicy, validateLegalHold } from "../../conformance/src/retention.mjs";
import { renderMarkdown } from "./render.mjs";
import { deletionPolicyProblems } from "./policy.mjs";
import { buildHold } from "./holds.mjs";
import { runDemo } from "./demo.mjs";

const problems = [];

export function collectProblems() {
  const policy = loadPolicy();

  // 1) Kontrakt + semantik.
  for (const e of validateDeletionPolicy(policy).errors) problems.push(`politik${e.path}: ${e.message}`);

  // 2) Eksemplet er den kanoniske politik.
  const example = loadCommittedExample();
  if (JSON.stringify(example) !== JSON.stringify(policy)) problems.push("contracts/examples/retention-deletion-policy.example.json er ikke identisk med retention/deletion-policy.json");

  // 3) Dokumentet er i trit.
  const expected = renderMarkdown(policy);
  let actual = null;
  try {
    actual = readFileSync(outputPath, "utf8");
  } catch {
    problems.push(`${outputPath} mangler; kør 'make retention-write'`);
  }
  if (actual !== null && actual !== expected) problems.push(`${outputPath} er ude af trit; kør 'make retention-write'`);

  // 4) Negativ semantik.
  const missingSurface = { ...policy, surfaces: policy.surfaces.filter((s) => s.kind !== "backup") };
  if (deletionPolicyProblems(missingSurface).length === 0) problems.push("semantikken afviser ikke en politik uden backup-dækning");
  const ruleOff = { ...policy, rules: { ...policy.rules, holdBlocksDeletion: false } };
  if (deletionPolicyProblems(ruleOff).length === 0) problems.push("semantikken afviser ikke en politik hvor hold ikke blokerer sletning");
  const aiAllowed = { ...policy, principals: { ...policy.principals, aiDenied: false } };
  if (deletionPolicyProblems(aiAllowed).length === 0) problems.push("semantikken afviser ikke en politik hvor AI må slette");
  let selfApprovedHold = false;
  try {
    buildHold({
      tenantId: "acme",
      subjectDigest: "a".repeat(64),
      dataClasses: ["personal"],
      reason: "verserende retssag kræver bevaring",
      placedBy: { subject: "oidc|a", name: "Anna", role: "privacy-officer" },
      approvedBy: { subject: "oidc|a", name: "Anna", role: "privacy-officer" },
    });
  } catch (err) {
    selfApprovedHold = err.code === "hold_invalid";
  }
  if (!selfApprovedHold) problems.push("semantikken afviser ikke et hold der godkender sig selv");
  if (validateLegalHold({}).ok) problems.push("semantikken afviser ikke et tomt hold");

  // 5) Funktionelt gennemløb på den rigtige stak.
  const demo = runDemo({ policy });
  try {
    if (demo.receipt.status !== "partial") problems.push(`gennemløbet skulle give 'partial', fik '${demo.receipt.status}'`);
    if (!demo.objectGone) problems.push("primærlageret indeholder stadig subjektets objekt efter sletning");
    const primary = demo.receipt.results.find((r) => r.kind === "primary");
    if (primary?.status !== "full") problems.push(`primærfladen skulle være 'full', var '${primary?.status}'`);
    if (demo.receipt.summary.remainingCopies < 1) problems.push("en partial-kvittering skal opgive mindst én resterende kopi");
    if (demo.holds.blocked.status !== "blocked-by-hold") problems.push("et aktivt hold blokerede ikke sletningen");
    if (demo.holds.blocked.summary.recordsAffected !== 0) problems.push("et blokeret hold må ikke slette noget");
    if (!demo.restore.opened) problems.push("gendannelsen startede ikke i karantæne");
    if (demo.restore.released.status !== "released") problems.push("gendannelsen blev ikke frigivet efter slettebeslutninger");
    const serialized = JSON.stringify(demo.audit);
    if (serialized.includes("kunde@example.org")) problems.push("revisionssporet indeholder en rå identifikator");
  } finally {
    demo.cleanup();
  }

  return problems;
}

function main() {
  const found = collectProblems();
  if (found.length) {
    console.error("✘ Retention-kontrol fejlede:\n");
    for (const p of found) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("✔ Slettepolitik, dækning, hold-blokering, ærlig partial og genanvendelse ved restore er verificeret");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
