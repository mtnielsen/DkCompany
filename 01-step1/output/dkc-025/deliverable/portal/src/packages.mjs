/**
 * DKC-025 — versionsstyrede servicepakker og bestillingspreview.
 *
 * En servicepakke er en versioneret, kundevendt samling af moduler med en
 * pris og en række konsekvenser, som kunden skal se **før** bestillingen. Den
 * er bevidst adskilt fra det tekniske komponentkatalog: kataloget beskriver
 * hvad der kan installeres, servicepakken beskriver hvad kunden bestiller og
 * hvad det koster at drive.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions } from "../../distribution/src/semver.mjs";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const portalDir = join(import.meta.dirname, "..");
export const packagesDir = join(portalDir, "service-packages");
export const repoRoot = join(portalDir, "..");

function isSemver(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

export function loadServicePackages(dir = packagesDir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), "utf8");
      try {
        return { file, package: JSON.parse(raw) };
      } catch (err) {
        throw new Error(`servicepakken ${file} er ikke gyldig JSON: ${err.message}`);
      }
    });
}

function err(path, message) {
  return { path, message };
}

/** Semantik et skema ikke kan udtrykke: pris, konsekvens-acknowledgement, modulrefs. */
export function servicePackageProblems(pkg, { componentIds = null } = {}) {
  const problems = [];
  if (!pkg) return [err("/", "servicepakken mangler")];

  const name = pkg.metadata?.name;
  const version = pkg.metadata?.version;
  if (!isSemver(version)) problems.push(err("/metadata/version", "servicepakken skal have en semver-version"));
  if (!isNamedHuman(pkg.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "servicepakken skal have et navngivet menneske som ansvarlig"));

  const modules = pkg.modules ?? [];
  if (modules.length === 0) problems.push(err("/modules", "servicepakken skal indeholde mindst ét modul"));
  const moduleIds = new Set();
  for (const [i, mod] of modules.entries()) {
    const path = `/modules/${i}`;
    if (!mod?.id) problems.push(err(path, "modulet mangler et id"));
    else if (moduleIds.has(mod.id)) problems.push(err(path, `modulet '${mod.id}' er angivet mere end én gang`));
    else moduleIds.add(mod.id);
    if (!mod?.versionRange) problems.push(err(`${path}/versionRange`, "modulet mangler et versionsinterval"));
    if (!mod?.reason || mod.reason.length < 10) problems.push(err(`${path}/reason`, "modulet skal have en begrundelse"));
    if (componentIds && mod?.id && !componentIds.has(mod.id)) problems.push(err(`${path}/id`, `modulet '${mod.id}' findes ikke i komponentkataloget`));
  }

  const price = pkg.price ?? {};
  if (price.currency !== "DKK") problems.push(err("/price/currency", "prisen skal angives i DKK"));
  if (!Number.isFinite(price.monthly) || price.monthly < 0) problems.push(err("/price/monthly", "den månedlige pris skal være et ikke-negativt tal"));
  if (!Number.isFinite(price.implementation) || price.implementation < 0) problems.push(err("/price/implementation", "implementeringsprisen skal være et ikke-negativt tal"));
  const componentSum = (price.components ?? []).reduce((sum, c) => sum + (Number.isFinite(c.monthly) ? c.monthly : 0), 0);
  if ((price.components ?? []).length && Math.abs(componentSum - price.monthly) > 0.001) {
    problems.push(err("/price/monthly", `den samlede pris (${price.monthly}) svarer ikke til summen af delpriser (${componentSum})`));
  }

  const ackIds = new Set();
  for (const [i, consequence] of (pkg.consequences ?? []).entries()) {
    const path = `/consequences/${i}`;
    if (!consequence?.id) problems.push(err(path, "konsekvensen mangler et id"));
    else if (ackIds.has(consequence.id)) problems.push(err(path, `konsekvensen '${consequence.id}' er angivet mere end én gang`));
    else ackIds.add(consequence.id);
    if (!["info", "notice", "material"].includes(consequence?.severity)) problems.push(err(`${path}/severity`, "konsekvensen skal have en kendt alvorlighed"));
    if (!consequence?.description || consequence.description.length < 10) problems.push(err(`${path}/description`, "konsekvensen skal beskrives tydeligt"));
  }
  if (!(pkg.consequences ?? []).some((c) => c.severity === "material")) {
    problems.push(err("/consequences", "en servicepakke skal mindst have én væsentlig (material) konsekvens, så kunden ser hvad den betyder"));
  }

  if (pkg.dataProcessing?.personalData === true && !(pkg.dataProcessing?.subprocessorRefs ?? []).length) {
    problems.push(err("/dataProcessing/subprocessorRefs", "en pakke med persondata skal angive sine underdatabehandlere"));
  }

  if (pkg.lifecycle?.orderable !== true) problems.push(err("/lifecycle/orderable", "kun pakker markeret som bestillingsbare kan bestilles"));
  if (pkg.lifecycle?.orderable === true && pkg.lifecycle?.sunsetAt) problems.push(err("/lifecycle/sunsetAt", "en bestillingsbar pakke må ikke være ved at udgå"));

  if (!name) problems.push(err("/metadata/name", "servicepakken mangler et navn"));
  return problems;
}

/** Vælg en pakke på id og (valgfri) version; nyeste version hvis intet angives. */
export function selectPackage(packages, { packageId, version = null } = {}) {
  const matches = packages
    .map((entry) => entry.package ?? entry)
    .filter((pkg) => pkg.metadata?.name === packageId);
  if (matches.length === 0) return null;
  if (!version) {
    return matches.slice().sort((a, b) => compareVersions(b.metadata.version, a.metadata.version))[0];
  }
  return matches.find((pkg) => pkg.metadata.version === version) ?? null;
}

/**
 * Beregn et bestillingspreview. Kunden ser den samlede driftspris, hver
 * delpris og hver konsekvens — og hvilke konsekvenser der kræver et eksplicit
 * acknowledgement — før ordren kan oprettes.
 */
export function orderPreview(pkg, { modules = null } = {}) {
  if (!pkg) throw new Error("orderPreview kræver en servicepakke");
  const included = new Set(modules ?? (pkg.modules ?? []).map((m) => m.id));
  const selected = (pkg.modules ?? []).filter((m) => included.has(m.id));
  const components = (pkg.price?.components ?? []).filter((c) => !c.moduleId || included.has(c.moduleId));
  const monthly = components.length ? components.reduce((sum, c) => sum + (Number(c.monthly) || 0), 0) : pkg.price?.monthly ?? 0;
  const consequences = (pkg.consequences ?? []).map((c) => ({ ...c, requiresAcknowledgment: c.severity === "material" || c.requiresAcknowledgment === true }));
  return {
    packageId: pkg.metadata?.name,
    version: pkg.metadata?.version,
    currency: pkg.price?.currency ?? "DKK",
    monthly,
    implementation: pkg.price?.implementation ?? 0,
    firstMonthTotal: monthly + (pkg.price?.implementation ?? 0),
    modules: selected.map((m) => ({ id: m.id, versionRange: m.versionRange, reason: m.reason })),
    components,
    consequences: consequences.map((c) => ({ id: c.id, severity: c.severity, description: c.description, requiresAcknowledgment: c.requiresAcknowledgment })),
    requiresAcknowledgment: consequences.filter((c) => c.requiresAcknowledgment).map((c) => c.id),
  };
}

/** Kontrollér at kunden har kvitteret for alle væsentlige konsekvenser. */
export function acknowledgmentProblems(pkg, acknowledged = []) {
  const preview = orderPreview(pkg);
  const acked = new Set(acknowledged);
  return preview.requiresAcknowledgment.filter((id) => !acked.has(id)).map((id) => ({
    path: "/acknowledgedConsequences",
    message: `kunden mangler at kvittere for den væsentlige konsekvens '${id}'`,
  }));
}
