/**
 * DKC-036 — fokuseret kontrol af enterprise- og branchepakker.
 *
 * Kontrollerer offline at:
 *   - kapabilitetsregisteret svarer til de faktiske komponentmanifester,
 *   - de tre størrelsesprofiler deler de samme sikkerhedskontrakter,
 *   - hver pakke har en navngivet produktejer og testkundekontakt,
 *   - hver pakke kan løses gennem den faktiske dependency-resolver og at
 *     kapabilitetskravene mod closuren er opfyldt (eller ærligt mangler),
 *   - højrisiko-AI og sektorregler er særskilte, uafklarede inputs,
 *   - en katalogpost ikke automatisk bliver en byggeopgave, og
 *   - den genererede rapport er i trit med kilden.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents, loadProfiles } from "../../distribution/src/catalog.mjs";
import {
  loadAll,
  capabilityCatalogProblems,
  packageCatalogProblems,
  reportProblems,
  REPORT_PATH,
  PACKAGE_IDS,
} from "./model.mjs";
import { resolveEnterprisePackage } from "./resolver.mjs";
import { evaluatePackageGate } from "./gate.mjs";
import { buildEnterpriseReport } from "./report.mjs";

export { buildEnterpriseReport };

export function runEnterpriseCheck(root = repoRoot) {
  const problems = [];
  const all = loadAll(root);
  const components = loadComponents();
  const profiles = loadProfiles();
  const exampleFiles = new Set(readdirSync(join(root, "contracts", "examples")));
  const context = {
    capabilities: all.capabilities,
    components,
    profiles,
    gatePolicy: all.gatePolicy,
    tco: all.tco,
    companyProfiles: all.companyProfiles,
    pilotProfiles: all.pilotProfiles,
    exampleFiles,
  };

  for (const e of capabilityCatalogProblems(all.capabilities, components)) problems.push(`enterprise/capabilities.json${e.path}: ${e.message}`);
  for (const e of packageCatalogProblems(all.packages, context)) problems.push(`enterprise/packages.json${e.path}: ${e.message}`);

  const canonicalIds = all.packages.packages.map((p) => p.id).sort();
  if (JSON.stringify(canonicalIds) !== JSON.stringify([...PACKAGE_IDS].sort())) {
    problems.push(`enterprise/packages.json: det kanoniske katalog skal indeholde præcis ${PACKAGE_IDS.join(", ")} (har ${canonicalIds.join(", ")})`);
  }

  const resolutions = [];
  for (const pkg of all.packages.packages) {
    const resolution = resolveEnterprisePackage(pkg, { components, profiles, capabilityCatalog: all.capabilities });
    resolutions.push(resolution);
    // Katalogposter må ikke automatisk blive byggeopgaver.
    if (pkg.implementation?.status === "ordered" && !pkg.implementation?.orderRef) {
      problems.push(`enterprise/packages.json: pakken '${pkg.id}' er bestilt uden en ordrereference`);
    }
    const gate = evaluatePackageGate(pkg, { resolution, components });
    if (gate.buildBacklog.length > 0 && pkg.implementation?.status !== "ordered") {
      problems.push(`enterprise/packages.json: pakken '${pkg.id}' har byggeopgaver uden en eksplicit ordre`);
    }
  }

  const report = buildEnterpriseReport(root);
  const onDiskPath = join(root, REPORT_PATH);
  let onDisk = null;
  try {
    onDisk = JSON.parse(readFileSync(onDiskPath, "utf8"));
  } catch (err) {
    problems.push(`enterprise/report/enterprise-package-report.json: kunne ikke læses (${err.message})`);
  }
  if (onDisk && JSON.stringify(onDisk) !== JSON.stringify(report)) {
    problems.push("enterprise/report/enterprise-package-report.json er ude af trit med kilden; kør 'make enterprise-render'");
  }
  for (const e of reportProblems(report)) problems.push(`enterprise/report/enterprise-package-report.json${e.path}: ${e.message}`);

  // Fail-closed påstande: ingen pakke må fremstå implementerbar uden en faglig afgørelse.
  if (!report.securityContracts.ok) problems.push("de tre størrelsesprofiler deler ikke de samme sikkerhedskontrakter");
  for (const pkg of report.packages) {
    if (pkg.implementable) problems.push(`pakken '${pkg.id}' fremstår implementerbar uden en underskrevet testkundeaftale og en bekræftet faglig afgørelse`);
    if (pkg.blockers.length === 0) problems.push(`pakken '${pkg.id}' har ingen blokeringer, selvom ingen faglig afgørelse er registreret`);
    if (pkg.highRiskAi.applicable && pkg.highRiskAi.status === "confirmed") {
      problems.push(`pakken '${pkg.id}' erklærer en bekræftet højrisiko-AI-vurdering uden en ekstern kilde`);
    }
    for (const app of pkg.apps) {
      if (app.implementation === "catalog-only" && pkg.buildBacklog.some((task) => task.component === app.id)) {
        problems.push(`pakken '${pkg.id}': katalogposten '${app.id}' er blevet en byggeopgave uden en menneskelig ordre`);
      }
    }
  }

  return { ok: problems.length === 0, problems, report, resolutions };
}
