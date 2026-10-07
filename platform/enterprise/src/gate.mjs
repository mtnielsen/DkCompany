/**
 * DKC-036 — fail-closed gate for enterprise- og branchepakker.
 *
 * En pakke kan ikke blive implementerbar, før:
 *   - den har en navngivet produktejer og en navngivet testkundekontakt,
 *   - testkundens aftale er underskrevet (en syntetisk testkunde er ikke nok),
 *   - hvert blokerende fagligt krav er bekræftet af et navngivet menneske,
 *   - sektorreglerne er vurderet, og
 *   - en eventuel højrisiko-AI-vurdering er bekræftet særskilt.
 *
 * En katalogpost bliver ikke automatisk til en bestilt byggeopgave: byggeopgaver
 * udledes kun af en eksplicit, menneskeligt godkendt ordre, og en catalog-only
 * komponent forbliver en katalogpost, indtil en sådan ordre findes.
 */
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

function isBlocking(req) {
  return req?.blocksImplementation === true && req?.status !== "confirmed" && req?.status !== "not-applicable";
}

export function deriveBuildBacklog(pkg, components = []) {
  const impl = pkg?.implementation ?? {};
  if (impl.status !== "ordered") return [];
  if (!impl.orderRef || !isNamedHuman(impl.approvedBy)) return [];
  const byName = new Map(components.map((entry) => [(entry.data ?? entry).metadata?.name, entry.data ?? entry]));
  return (pkg.apps ?? [])
    .map((id) => ({ component: id, implementation: byName.get(id)?.implementation?.status ?? "unknown" }))
    .filter((row) => row.implementation === "implemented")
    .map((row) => ({ component: row.component, source: "explicit-order", reason: `Bestilt eksplicit med ordre ${impl.orderRef}; en katalogpost bliver først en byggeopgave efter en menneskelig ordre.` }));
}

export function evaluatePackageGate(pkg, { resolution = null, components = [] } = {}) {
  const blockers = [];
  if (!isNamedHuman(pkg?.productOwner)) blockers.push("mangler en navngivet produktejer");
  if (!isNamedHuman(pkg?.testCustomer?.contact)) blockers.push("mangler en navngivet testkundekontakt");
  if (pkg?.testCustomer?.status !== "consented") blockers.push("testkundens aftale er ikke underskrevet");
  if (pkg?.testCustomer?.synthetic === true) blockers.push("testkunden er en syntetisk reference uden en underskrevet aftale");

  for (const req of pkg?.professionalRequirements ?? []) {
    if (isBlocking(req)) blockers.push(`det faglige krav '${req.id}' er '${req.status}' og afventer et navngivet menneske`);
  }
  if (pkg?.sectorRules?.status && pkg.sectorRules.status !== "not-applicable" && pkg.sectorRules.status !== "confirmed") {
    blockers.push(`sektorvurderingen er '${pkg.sectorRules.status}'`);
  }
  if (pkg?.highRiskAi?.applicable === true && pkg.highRiskAi.status !== "confirmed") {
    blockers.push(`højrisiko-AI-vurderingen er '${pkg.highRiskAi.status}' og er en særskilt vurdering`);
  }
  if (resolution && !resolution.ok) {
    for (const e of resolution.errors) blockers.push(e);
  }

  const byName = new Map(components.map((entry) => [(entry.data ?? entry).metadata?.name, entry.data ?? entry]));
  const catalogOnly = (pkg?.apps ?? [])
    .map((id) => ({ component: id, implementation: byName.get(id)?.implementation?.status ?? "unknown" }))
    .filter((row) => row.implementation === "catalog-only")
    .map((row) => row.component);

  const implStatus = pkg?.implementation?.status ?? "blocked";
  const approvedOrder = ["approved", "ordered"].includes(implStatus) && Boolean(pkg?.implementation?.orderRef) && isNamedHuman(pkg?.implementation?.approvedBy);
  const implementable = blockers.length === 0 && approvedOrder;
  if (!approvedOrder) blockers.push("pakken er ikke eksplicit godkendt med en ordrereference og et navngivet menneske");

  return {
    id: pkg?.id,
    implementable,
    implementationStatus: implStatus,
    blockers: [...new Set(blockers)],
    catalogOnlyNotBuildTasks: catalogOnly,
    buildBacklog: deriveBuildBacklog(pkg, components),
  };
}
