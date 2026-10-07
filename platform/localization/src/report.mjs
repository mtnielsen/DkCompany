/**
 * DKC-035 — deterministisk modulregistreringsrapport.
 *
 * Samme katalog og tidspunkt giver byte-identisk output, så `localization-check`
 * kan afvise en rapport der er ude af trit med kilden. Rapporten erklærer
 * `measured: false`; en faktisk adapter er en særskilt opgave.
 */
import { loadComponents } from "../../distribution/src/catalog.mjs";
import {
  loadAll,
  REPORT_PATH,
  REPORT_DOC_PATH,
  DEFAULT_REPORT_GENERATED_AT,
} from "./model.mjs";
import { evaluateFamilyCandidates } from "./candidates.mjs";
import { buildCoverageMatrix, coverageSummary } from "./coverage.mjs";
import { evaluateFamilyGate, evaluatePaymentGate } from "./gate.mjs";
import { resolveFamilyComponents, checkAdapterInterface } from "./integration.mjs";

export { REPORT_PATH, REPORT_DOC_PATH };

export function buildLocalizationReport(root, { at = DEFAULT_REPORT_GENERATED_AT } = {}) {
  const all = loadAll(root);
  const components = loadComponents();
  const componentByName = new Map(components.map((c) => [c.data.metadata.name, c.data]));
  const families = [...all.families.families].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const familyReports = families.map((family) => {
    const candidate = evaluateFamilyCandidates(root, family);
    const gate = evaluateFamilyGate(family, all.requirements, all.interfaces, candidate);
    const component = componentByName.get(family.components[0]);
    const iface = all.interfaces.interfaces.find((i) => i.id === family.adapterInterface);
    const interfaceProblems = component ? checkAdapterInterface(iface, component) : [];
    return {
      id: family.id,
      title: family.title,
      order: family.order,
      familyStatus: family.familyStatus,
      danishReady: gate.danishReady,
      components: family.components,
      adapterInterface: family.adapterInterface,
      candidate: {
        selected: candidate.selected,
        gateStatus: candidate.selectedGateStatus,
        matchesDeclaration: candidate.matchesDeclaration,
        candidates: candidate.candidates.map((c) => ({
          product: c.product,
          candidateRef: c.candidateRef,
          declaredSelected: c.declaredSelected,
          score: c.score,
          reasons: c.reasons,
          gateStatus: c.gateStatus,
          blockers: c.blockers,
        })),
      },
      pendingGates: gate.pendingGates,
      advisoryGates: gate.advisoryGates,
      payment: gate.payment,
      interfaceProblems,
    };
  });

  const coverageMatrix = buildCoverageMatrix(all.families, all.requirements);
  const resolution = families.map((f) => resolveFamilyComponents(f, { components }));
  const paymentGate = evaluatePaymentGate(all.interfaces);

  const summary = {
    families: families.length,
    pendingLegalReview: familyReports.filter((f) => f.familyStatus === "pending-legal-review").length,
    registered: familyReports.filter((f) => f.familyStatus === "registered").length,
    danishReady: familyReports.filter((f) => f.danishReady).length,
    coverage: coverageSummary(coverageMatrix),
    resolvable: resolution.filter((r) => r.ok).length,
    unresolved: resolution.filter((r) => !r.ok).length,
  };

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ModuleRegistrationReport",
    metadata: {
      name: "platform-module-registration-report",
      version: "1.0.0",
      description: "Deterministisk modulregistrering for økonomi, HR, tid, fakturering og handel: familier, kandidatrapporter, dækningsmatrix for dansk lokalisering, adaptergrænseflader, resolver-integration og fail-closed gates. Rapporten registrerer katalogposter — den erklærer ikke en fungerende forretningsapplikation.",
      accountableHuman: all.families.metadata.accountableHuman,
      labels: all.families.metadata.labels ?? {},
    },
    generatedAt: at,
    measured: false,
    families: familyReports,
    coverageMatrix,
    summary,
  };
}

function renderDoc(report) {
  const lines = [];
  lines.push("# Modulregistrering for økonomi, HR og handel — rapport");
  lines.push("");
  lines.push("> Genereret af `make localization-render` som en deterministisk kontrol. **Målt:** nej — en faktisk adapter og en menneskelig faglig afgørelse kræver en ekstern kilde.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Familier:** ${report.summary.families} (${report.summary.pendingLegalReview} afventer jura, ${report.summary.registered} registrerede, ${report.summary.danishReady} danskklare)`);
  lines.push(`- **Dækning:** ${report.summary.coverage.full} fuld, ${report.summary.coverage.partial} delvis, ${report.summary.coverage.unsupported} ikke undersøgt`);
  lines.push(`- **Resolver:** ${report.summary.resolvable} af ${report.summary.families} familier resolver uden fejl`);
  lines.push("");
  lines.push("## Familier");
  lines.push("");
  lines.push("| Rækkefølge | Familie | Status | Danskklar | Kandidat | Kandidatgate | Afventende gates |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const f of report.families) {
    lines.push(`| ${f.order} | ${f.title} (${f.id}) | ${f.familyStatus} | ${f.danishReady ? "ja" : "nej"} | ${f.candidate.selected ?? "—"} | ${f.candidate.gateStatus} | ${f.pendingGates.map((g) => `${g.id}:${g.status}`).join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Dækningsmatrix");
  lines.push("");
  lines.push("| Familie | Krav | Status | Blokerer |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of report.coverageMatrix) {
    lines.push(`| ${row.family} | ${row.requirement} | ${row.status} | ${row.blocksDanishReady ? "ja" : "nej"} |`);
  }
  lines.push("");
  lines.push("## Kandidatrapporter");
  lines.push("");
  for (const f of report.families) {
    lines.push(`### ${f.title} (${f.id})`);
    lines.push("");
    lines.push("| Produkt | Version | Score | Gate | Begrundelse |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const c of f.candidate.candidates) {
      lines.push(`| ${c.product} | ${c.candidateRef} | ${c.score} | ${c.gateStatus} | ${c.reasons.join(", ") || "—"} |`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

export function renderLocalizationReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
