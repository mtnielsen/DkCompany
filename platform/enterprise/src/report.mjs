/**
 * DKC-036 — deterministisk rapport for enterprise- og branchepakker.
 *
 * Samme katalog og tidspunkt giver byte-identisk output, så `enterprise-check`
 * kan afvise en rapport der er ude af trit med kilden. Rapporten erklærer
 * `measured: false`; en faktisk testkunde, en underskrevet aftale og en
 * bekræftet faglig/sektor-/AI-vurdering er særskilt NOT RUN.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadComponents, loadProfiles } from "../../distribution/src/catalog.mjs";
import {
  loadAll,
  securityContractProblems,
  reportProblems,
  DEFAULT_REPORT_GENERATED_AT,
  REPORT_PATH,
  REPORT_DOC_PATH,
} from "./model.mjs";
import { resolveEnterprisePackage } from "./resolver.mjs";
import { evaluatePackageGate } from "./gate.mjs";
import { prioritizePackages } from "./priority.mjs";

export { REPORT_PATH, REPORT_DOC_PATH, reportProblems };

export function buildEnterpriseReport(root, { at = DEFAULT_REPORT_GENERATED_AT } = {}) {
  const all = loadAll(root);
  const components = loadComponents();
  const profiles = loadProfiles();
  const exampleFiles = new Set(readdirSync(join(root, "contracts", "examples")));
  const sharedContractsOk = securityContractProblems(all.packages, all.gatePolicy, profiles).length === 0;

  const priority = prioritizePackages(all.packages.packages, { pilotProfiles: all.pilotProfiles, tco: all.tco });
  const priorityById = new Map(priority.map((row) => [row.id, row]));

  const packages = [...all.packages.packages]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((pkg) => {
      const resolution = resolveEnterprisePackage(pkg, { components, profiles, capabilityCatalog: all.capabilities });
      const gate = evaluatePackageGate(pkg, { resolution, components });
      const provided = new Set(resolution.capabilities ?? []);
      const row = priorityById.get(pkg.id);
      return {
        id: pkg.id,
        title: pkg.title,
        segment: pkg.segment,
        order: pkg.order,
        baseProfileRef: pkg.baseProfileRef,
        profile: resolution.profile ?? pkg.baseProfileRef,
        selectionRationale: pkg.selectionRationale,
        demand: {
          segments: pkg.demand.segments,
          pilotProfileRefs: pkg.demand.pilotProfileRefs,
          businessProfileRefs: pkg.demand.businessProfileRefs,
          demandRank: pkg.demand.demandRank,
          rationale: pkg.demand.rationale,
        },
        apps: (pkg.apps ?? []).map((id) => ({
          id,
          implementation: components.find((entry) => entry.data.metadata.name === id)?.data.implementation?.status ?? "unknown",
          capability: (components.find((entry) => entry.data.metadata.name === id)?.data.provides?.capabilities ?? []).slice().sort(),
        })),
        capabilities: {
          required: [...(pkg.capabilityConstraints.required ?? [])].sort(),
          forbidden: [...(pkg.capabilityConstraints.forbidden ?? [])].sort(),
          controlPlane: [...(pkg.capabilityConstraints.controlPlane ?? [])].sort(),
          provided: [...provided].sort(),
          missing: (pkg.capabilityConstraints.required ?? []).filter((id) => !provided.has(id)).sort(),
          forbiddenPresent: (pkg.capabilityConstraints.forbidden ?? []).filter((id) => provided.has(id)).sort(),
        },
        isolation: pkg.isolation,
        dataOwnership: (pkg.dataOwnership ?? []).map((own) => ({ dataClass: own.dataClass, owner: own.owner, residency: own.residency, retentionRef: own.retentionRef })),
        integrations: (pkg.integrations ?? []).map((integration) => ({ ...integration })),
        professionalRequirements: (pkg.professionalRequirements ?? []).map((req) => ({ id: req.id, title: req.title, authority: req.authority, status: req.status, blocksImplementation: req.blocksImplementation })),
        sectorRules: { regimes: pkg.sectorRules.regimes, status: pkg.sectorRules.status, assessmentRef: pkg.sectorRules.assessmentRef },
        highRiskAi: { applicable: pkg.highRiskAi.applicable, status: pkg.highRiskAi.status, assessmentRef: pkg.highRiskAi.assessmentRef },
        productOwner: pkg.productOwner,
        testCustomer: { name: pkg.testCustomer.name, status: pkg.testCustomer.status, synthetic: pkg.testCustomer.synthetic, rule: pkg.testCustomer.rule ?? null },
        implementation: pkg.implementation,
        tco: row?.tco ?? null,
        demandScore: row?.demandScore ?? 0,
        priorityScore: row?.priorityScore ?? 0,
        blockers: gate.blockers,
        implementable: gate.implementable,
        catalogOnlyNotBuildTasks: gate.catalogOnlyNotBuildTasks,
        buildBacklog: gate.buildBacklog,
        sharedSecurityContracts: sharedContractsOk,
      };
    });

  const resolutionErrors = packages.flatMap((pkg) => (pkg.capabilities.missing ?? []).map((cap) => `${pkg.id}: ${cap}`));

  const summary = {
    packages: packages.length,
    implementable: packages.filter((p) => p.implementable).length,
    blocked: packages.filter((p) => !p.implementable).length,
    highRiskAiSeparate: packages.filter((p) => p.highRiskAi.applicable && p.highRiskAi.status !== "confirmed").length,
    catalogOnlyComponents: [...new Set(packages.flatMap((p) => p.catalogOnlyNotBuildTasks))].sort(),
    sharedSecurityContracts: sharedContractsOk,
    unresolvedCapabilities: [...new Set(resolutionErrors)].sort(),
  };

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EnterprisePackageReport",
    metadata: {
      name: "platform-enterprise-package-report",
      version: "1.0.0",
      description: "Deterministisk rapport for enterprise- og branchepakker: fælles sikkerhedskontrakter, kapabilitetskrav mod den faktiske resolver, dataejerskab, ekstra isolation, integrationer, faglige krav, sektorregler, højrisiko-AI, navngivne ejere og testkunder samt prioritering efter efterspørgsel og dokumenteret TCO. Rapporten erklærer ingen pakke implementerbar uden en underskrevet testkundeaftale og en bekræftet faglig afgørelse.",
      accountableHuman: all.packages.metadata.accountableHuman,
      labels: all.packages.metadata.labels ?? {},
    },
    generatedAt: at,
    measured: false,
    securityContracts: {
      ref: all.packages.securityContracts.ref,
      sharedBy: all.packages.securityContracts.sharedBy,
      ok: sharedContractsOk,
      contracts: all.packages.securityContracts.contracts.map((c) => c.id),
    },
    priority: priority.map((row, index) => ({ position: index + 1, ...row })),
    packages,
    summary,
  };
}

function renderDoc(report) {
  const lines = [];
  lines.push("# Enterprise- og branchepakker — rapport");
  lines.push("");
  lines.push("> Genereret af `make enterprise-render` som en deterministisk kontrol. **Målt:** nej — en faktisk testkunde, en underskrevet aftale og en bekræftet faglig/sektor-/AI-vurdering kræver en ekstern kilde.");
  lines.push("");
  lines.push(`- **Genereret:** ${report.generatedAt}`);
  lines.push(`- **Pakker:** ${report.summary.packages} (${report.summary.blocked} blokerede, ${report.summary.implementable} implementerbare)`);
  lines.push(`- **Fælles sikkerhedskontrakter:** ${report.securityContracts.ok ? "delte" : "IKKE delte"} (${report.securityContracts.sharedBy.join(", ")})`);
  lines.push(`- **Højrisiko-AI med særskilt vurdering:** ${report.summary.highRiskAiSeparate}`);
  lines.push(`- **Katalogposter der ikke er byggeopgaver:** ${report.summary.catalogOnlyComponents.join(", ") || "ingen"}`);
  lines.push("");
  lines.push("## Prioritering efter efterspørgsel og TCO");
  lines.push("");
  lines.push("| # | Pakke | Efterspørgsel | TCO (12 mdr.) | Score |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of report.priority) {
    lines.push(`| ${row.position} | ${row.title} (\`${row.id}\`) | ${row.demandScore} | ${row.tco ? `${row.tco.twelveMonthTco} (${row.tco.profileId})` : "—"} | ${row.priorityScore} |`);
  }
  lines.push("");
  lines.push("## Pakker");
  lines.push("");
  lines.push("| Pakke | Segment | Basisprofil | Implementerbar | Testkunde | Højrisiko-AI | Blokeringer |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const pkg of report.packages) {
    lines.push(`| ${pkg.title} (\`${pkg.id}\`) | ${pkg.segment} | ${pkg.profile} | ${pkg.implementable ? "ja" : "nej"} | ${pkg.testCustomer.name} (${pkg.testCustomer.status}) | ${pkg.highRiskAi.applicable ? pkg.highRiskAi.status : "—"} | ${pkg.blockers.length} |`);
  }
  lines.push("");
  lines.push("## Kapabiliteter og resolver");
  lines.push("");
  lines.push("| Pakke | Krævede | Manglende | Forbudte til stede | Kontrolplan |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const pkg of report.packages) {
    lines.push(`| \`${pkg.id}\` | ${pkg.capabilities.required.join(", ")} | ${pkg.capabilities.missing.join(", ") || "—"} | ${pkg.capabilities.forbiddenPresent.join(", ") || "—"} | ${pkg.capabilities.controlPlane.join(", ")} |`);
  }
  lines.push("");
  lines.push("## Dataejerskab og isolation");
  lines.push("");
  for (const pkg of report.packages) {
    lines.push(`### ${pkg.title} (\`${pkg.id}\`)`);
    lines.push("");
    lines.push(`- **Isolation:** ${pkg.isolation.level} (dedikerede databaser: ${pkg.isolation.dedicatedDatabases}, netværkssegmentering: ${pkg.isolation.networkSegmentation}, immutable audit: ${pkg.isolation.immutableAudit})`);
    lines.push(`- **Produktejer:** ${pkg.productOwner.name} (${pkg.productOwner.role})`);
    lines.push(`- **Testkunde:** ${pkg.testCustomer.name} — ${pkg.testCustomer.status}${pkg.testCustomer.synthetic ? " (syntetisk)" : ""}`);
    lines.push(`- **Dataejerskab:** ${pkg.dataOwnership.map((o) => `${o.dataClass} → ${o.owner.name}`).join("; ")}`);
    lines.push(`- **Faglige krav:** ${pkg.professionalRequirements.map((r) => `${r.id}:${r.status}`).join(", ")}`);
    lines.push(`- **Sektorregler:** ${pkg.sectorRules.regimes.join(", ") || "—"} (${pkg.sectorRules.status})`);
    lines.push(`- **Højrisiko-AI:** ${pkg.highRiskAi.applicable ? pkg.highRiskAi.status : "ikke anvendelig"}`);
    lines.push(`- **Katalogposter der IKKE er byggeopgaver:** ${pkg.catalogOnlyNotBuildTasks.join(", ") || "ingen"}`);
    lines.push(`- **Byggeopgaver fra eksplicit ordre:** ${pkg.buildBacklog.length}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

export function renderEnterpriseReport(report) {
  const rendered = new Map();
  rendered.set(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  rendered.set(REPORT_DOC_PATH, renderDoc(report));
  return rendered;
}
