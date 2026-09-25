/**
 * DKC-035 — fokuseret kontrol af modulregistreringen.
 *
 * Kontrollerer offline at:
 *   - lokaliseringskravene, adaptergrænsefladerne og familiekataloget er
 *     semantisk konsistente,
 *   - hver katalogkomponents `localization`-blok peger på noget, der findes,
 *   - hver familie kan løses gennem den faktiske dependency-resolver,
 *   - adaptergrænsefladen dækker modulets driftsverber og dataklasser,
 *   - regnskab/løn ikke er danskklare uden en faglig afgørelse, og
 *   - betaling kræver en godkendt ekstern tjeneste med begrænsede scopes,
 *   - den genererede rapport er i trit med kilden.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents } from "../../distribution/src/catalog.mjs";
import {
  loadAll,
  localeRequirementProblems,
  adapterInterfaceProblems,
  familyCatalogProblems,
  componentLocalizationProblems,
  REPORT_PATH,
} from "./model.mjs";
import { buildLocalizationReport } from "./report.mjs";

export { buildLocalizationReport };

export function runLocalizationCheck(root = repoRoot) {
  const problems = [];
  const all = loadAll(root);
  const components = loadComponents();
  const exampleFiles = readdirSync(join(root, "contracts", "examples"));

  for (const e of localeRequirementProblems(all.requirements)) problems.push(`localization/locale-requirements.json${e.path}: ${e.message}`);
  for (const e of adapterInterfaceProblems(all.interfaces)) problems.push(`localization/adapter-interfaces.json${e.path}: ${e.message}`);
  for (const e of familyCatalogProblems(all.families, { components, requirements: all.requirements, interfaces: all.interfaces, exampleFiles })) {
    problems.push(`localization/families.json${e.path}: ${e.message}`);
  }
  for (const entry of components) {
    for (const e of componentLocalizationProblems(entry.data, { families: all.families, requirements: all.requirements, interfaces: all.interfaces, exampleFiles })) {
      problems.push(`${entry.file}${e.path}: ${e.message}`);
    }
  }

  const report = buildLocalizationReport(root);
  const onDiskPath = join(root, REPORT_PATH);
  let onDisk = null;
  try {
    onDisk = JSON.parse(readFileSync(onDiskPath, "utf8"));
  } catch (err) {
    problems.push(`localization/report/localization-report.json: kunne ikke læses (${err.message})`);
  }
  if (onDisk && JSON.stringify(onDisk) !== JSON.stringify(report)) {
    problems.push("localization/report/localization-report.json er ude af trit med kilden; kør 'make localization-render'");
  }

  // Fail-closed gate-påstande: en katalogpost må ikke fremstå danskklar.
  const finance = report.families.find((f) => f.id === "finance");
  const hr = report.families.find((f) => f.id === "hr");
  if (finance && finance.danishReady) problems.push("økonomifamilien er markeret danskklar uden en faglig afgørelse");
  if (hr && hr.danishReady) problems.push("HR-familien er markeret danskklar uden en lønansvarligs afgørelse");
  if (!finance || !finance.pendingGates.some((g) => g.id === "accounting")) problems.push("økonomifamilien mangler den blokerende bogføring-gate");
  if (!hr || !hr.pendingGates.some((g) => g.id === "payroll")) problems.push("HR-familien mangler den blokerende løn-gate");
  const payment = report.families.map((f) => f.payment).find(Boolean);
  if (!payment || payment.approved) problems.push("betaling fremstår godkendt uden en godkendt ekstern tjeneste");
  const accountingCoverage = report.coverageMatrix.find((r) => r.family === "finance" && r.requirement === "accounting");
  if (!accountingCoverage || accountingCoverage.status !== "unsupported") problems.push("bogføring er ikke ærligt markeret som ikke undersøgt");

  return { ok: problems.length === 0, problems, report };
}
