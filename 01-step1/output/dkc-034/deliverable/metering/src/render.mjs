/**
 * DKC-034 — render forbrugsrapporten og TCO-sammenligningen.
 *
 * Samme input giver byte-identisk output, så `metering-check` kan afvise en
 * rapport, der er ude af trit med prisbog, forbrugsjournal og driftsudgifter.
 */
import {
  COST_REPORT_PATH,
  TCO_COMPARISON_PATH,
  COST_REPORT_DOC_PATH,
  TCO_DOC_PATH,
  METERS,
} from "./model.mjs";

function dkk(value, currency) {
  return `${value.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function renderCostReportDoc(report) {
  const lines = [];
  lines.push("# Forbrugs- og driftsomkostningsrapport");
  lines.push("");
  lines.push(`> Genereret af \`make metering-render\` som en deterministisk aggregering. **Målt:** nej — en faktisk afstemning kræver en levende faktura.`);
  lines.push("");
  lines.push(`- **Valuta:** ${report.currency}`);
  lines.push(`- **Prisbog:** \`${report.priceBookRef}\``);
  lines.push(`- **Forbrugsjournal:** \`${report.usageLedgerRef}\``);
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Samlet afstemning:** ${report.reconciliation.status} (faktisk ${dkk(report.reconciliation.actualTotal, report.currency)} vs. driftsudgift ${report.reconciliation.operatingExpenseTotal === null ? "ukendt" : dkk(report.reconciliation.operatingExpenseTotal, report.currency)})`);
  lines.push("");
  lines.push("## Forbrug pr. tenant");
  lines.push("");
  lines.push("| Tenant | Pakke | Faktisk | Estimeret | I alt | Stopgrænse | Budget | Afstemning |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- | --- |");
  for (const tenant of report.tenants) {
    lines.push(
      `| ${tenant.tenantId} | ${tenant.packageId} | ${dkk(tenant.actualTotal, report.currency)} | ${dkk(tenant.estimatedTotal, report.currency)} | ${dkk(tenant.total, report.currency)} | ${dkk(tenant.stopLimit.monthlyLimit, report.currency)} | ${tenant.budgetStatus} | ${tenant.reconciliation.status} |`
    );
  }
  lines.push("");
  lines.push("## Opdeling pr. måler");
  lines.push("");
  lines.push(`| Måler | ${report.tenants.map((t) => t.tenantId).join(" | ")} |`);
  lines.push(`| --- | ${report.tenants.map(() => "---:").join(" | ")} |`);
  for (const meter of METERS) {
    const cells = report.tenants.map((t) => dkk(t.breakdown[meter] ?? 0, report.currency));
    lines.push(`| ${meter} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Uudmålte / manuelt indtastede omkostninger");
  lines.push("");
  lines.push("Disse omkostninger er bevidst ikke udmålt i modellen. De skal indtastes manuelt og kan først kaldes målte, når en faktura foreligger.");
  lines.push("");
  lines.push("| Måler | Månedsværdi | Ejer | Begrundelse |");
  lines.push("| --- | ---: | --- | --- |");
  for (const item of report.tenants[0]?.unmeasured ?? []) {
    lines.push(`| ${item.meter} | ${item.monthlyValue === null ? "ikke udmålt" : dkk(item.monthlyValue, report.currency)} | ${item.owner.name} | ${item.reason} |`);
  }
  lines.push("");
  lines.push("## Prognose og stopgrænser");
  lines.push("");
  for (const tenant of report.tenants) {
    lines.push(`### ${tenant.tenantId}`);
    lines.push("");
    lines.push(`- Prognose (${tenant.forecast.method}): ${dkk(tenant.forecast.projectedMonthly, report.currency)} = ${tenant.forecast.percentOfLimit} % af grænsen`);
    lines.push(`- Stopgrænse: ${dkk(tenant.stopLimit.monthlyLimit, report.currency)} (advarsel ved ${tenant.stopLimit.warningPercent} %, handling ved overskridelse: ${tenant.stopLimit.onExceed})`);
    lines.push(`- Status: **${tenant.budgetStatus}**; dublerede hændelser fjernet: ${tenant.duplicateEvents}`);
    lines.push("");
  }
  lines.push("## Afstemning mod driftsudgifter");
  lines.push("");
  lines.push("| Tenant | Faktisk forbrug | Driftsudgift | Afvigelse | Tolerance | Status |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const tenant of report.tenants) {
    const r = tenant.reconciliation;
    lines.push(`| ${tenant.tenantId} | ${dkk(r.actualTotal, report.currency)} | ${r.operatingExpenseTotal === null ? "ukendt" : dkk(r.operatingExpenseTotal, report.currency)} | ${r.variancePercent === null ? "—" : `${r.variancePercent} %`} | ${r.tolerancePercent} % | ${r.status} |`);
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

function renderTcoDoc(tco) {
  const lines = [];
  lines.push("# TCO-sammenligning for tre virksomhedsprofiler");
  lines.push("");
  lines.push(`> Genereret af \`make metering-render\`. Tallene er en **model**, ikke en målt besparelse.`);
  lines.push("");
  lines.push(`- **Valuta:** ${tco.currency}`);
  lines.push(`- **Kundens udgangspunkt:** ${tco.baselineSource}`);
  lines.push(`- **Målt:** nej`);
  lines.push("");
  for (const profile of tco.profiles) {
    lines.push(`## ${profile.name} (${profile.companySize})`);
    lines.push("");
    lines.push(`- Nuværende månedsomkostning: ${dkk(profile.currentMonthlyCost, tco.currency)} (${profile.currentCostSource})`);
    lines.push(`- Modelleret platformpris: ${dkk(profile.platformMonthlyCost, tco.currency)}`);
    lines.push(`- Migrering (engang): ${dkk(profile.migrationOneTimeCost, tco.currency)}`);
    lines.push(`- 12-måneders TCO: ${dkk(profile.twelveMonthTco, tco.currency)}`);
    lines.push(`- Modeldifference pr. måned: ${dkk(profile.savingsMonthly, tco.currency)} (${profile.savingsPercent} %) — ikke en målt besparelse`);
    lines.push("");
    lines.push("| Måler | Nu | Platform | Note |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const line of profile.costLines) {
      lines.push(`| ${line.meter} | ${dkk(line.currentCost, tco.currency)} | ${dkk(line.platformCost, tco.currency)} | ${line.note} |`);
    }
    lines.push("");
    lines.push(`_${profile.estimationNote}_`);
    lines.push("");
  }
  lines.push("## Claim-politik");
  lines.push("");
  lines.push(`- Besparelsespåstand: **${tco.claims.savingsClaimed ? "ja" : "nej"}**`);
  lines.push(`- Sammenlignelige data: ${tco.claims.comparableDataRef ?? "ikke dokumenteret"}`);
  lines.push(`- Ingen påstand om gratis drift: **${tco.claims.noFreeOperation ? "bekræftet" : "afvist"}**`);
  lines.push(`- Ingen påstand om fuld SaaS-erstatning: **${tco.claims.notFullSaasReplacement ? "bekræftet" : "afvist"}**`);
  lines.push(`- Dokumentation: ${tco.claims.documentationRefs.map((r) => `\`${r}\``).join(", ")}`);
  lines.push("");
  lines.push(tco.claims.rationale);
  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderMetering({ costReport, tcoComparison }) {
  const rendered = new Map();
  rendered.set(COST_REPORT_PATH, JSON.stringify(costReport, null, 2) + "\n");
  rendered.set(TCO_COMPARISON_PATH, JSON.stringify(tcoComparison, null, 2) + "\n");
  rendered.set(COST_REPORT_DOC_PATH, renderCostReportDoc(costReport));
  rendered.set(TCO_DOC_PATH, renderTcoDoc(tcoComparison));
  return rendered;
}
