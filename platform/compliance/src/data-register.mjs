/**
 * DKC-019 — dataregister og retentionkonfiguration.
 *
 * Den kanoniske kilde er `compliance/data-register.json`. Den valideres mod
 * `contracts/data-register.schema.json` og de semantiske regler i
 * `conformance/src/data-register.mjs`, krydsrefereres mod de rigtige
 * pilotmoduler og modelroutes, og `docs/compliance/data-register.md`
 * genereres herfra. `make data-register-check` fejler, hvis dokumentet er ude
 * af trit, eller hvis en post mangler ejer, er uafklaret eller peger forkert.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { validateDataRegister, dataRegisterProblems, entryBlockers, isPersonalEntry, PERSONAL_DATA_CATEGORIES } from "../../conformance/src/data-register.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const registerPath = join(repoRoot, "compliance", "data-register.json");
export const outputPath = join(repoRoot, "docs", "compliance", "data-register.md");
export const modulesDir = join(repoRoot, "modules");
export const routesPath = join(repoRoot, "gateway", "routes.json");

/** Pilotmoduler: rigtige moduler, ikke den bevidst brudte fixture. */
export function pilotModules({ exclude = ["dummy-broken"] } = {}) {
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((name) => !exclude.includes(name) && existsSync(join(modulesDir, name, "module-manifest.json")))
    .sort()
    .map((name) => ({ name, manifest: JSON.parse(readFileSync(join(modulesDir, name, "module-manifest.json"), "utf8")) }));
}

export function loadRoutes(path = routesPath) {
  if (!existsSync(path)) return [];
  const config = JSON.parse(readFileSync(path, "utf8"));
  return (config.routes ?? []).filter((r) => r.enabled !== false);
}

/**
 * Krydsreferér registeret mod de rigtige moduler og routes. Returnerer en
 * liste af problemer (tom = konsistent). Bruges både af CLI'ens `check` og af
 * konformanssuitten.
 */
export function checkRepoReferences(register, { modules = pilotModules(), routes = loadRoutes() } = {}) {
  const problems = [];
  const entries = register?.entries ?? [];

  const byModule = new Map();
  const byRoute = new Map();
  for (const entry of entries) {
    if (entry.moduleRef) {
      if (byModule.has(entry.moduleRef)) problems.push(`flere registerposter peger på modulet '${entry.moduleRef}'`);
      byModule.set(entry.moduleRef, entry);
    }
    if (entry.routeRef) {
      if (byRoute.has(entry.routeRef)) problems.push(`flere registerposter peger på routen '${entry.routeRef}'`);
      byRoute.set(entry.routeRef, entry);
    }
  }

  const moduleNames = new Set(modules.map((m) => m.name));
  for (const mod of modules) {
    const entry = byModule.get(mod.name);
    if (!entry) {
      problems.push(`pilotmodulet '${mod.name}' har ingen registerpost — ejer og behandling kan ikke udledes implicit`);
      continue;
    }
    if (entry.status !== "approved") problems.push(`pilotmodulet '${mod.name}' har en registerpost, der ikke er godkendt ('${entry.status}')`);
    const ownerSubject = entry.owner?.subject;
    const accountable = mod.manifest?.metadata?.accountableHuman?.subject;
    if (accountable && ownerSubject !== accountable) {
      problems.push(`pilotmodulet '${mod.name}': registerpostens ejer '${ownerSubject}' matcher ikke modulets ansvarlige '${accountable}'`);
    }
  }

  const routeIds = new Set(routes.map((r) => r.id));
  for (const route of routes) {
    const entry = byRoute.get(route.id);
    if (!entry) {
      problems.push(`modelrouten '${route.id}' har ingen registerpost — en route uden registerpost må ikke behandle persondata`);
      continue;
    }
    if (entry.status !== "approved") problems.push(`modelrouten '${route.id}' har en registerpost, der ikke er godkendt ('${entry.status}')`);
    const routePersonal = (route.dataClasses ?? []).some((c) => PERSONAL_DATA_CATEGORIES.has(c));
    if (routePersonal) {
      if (route.approvedDataProcessing !== true) problems.push(`modelrouten '${route.id}' tillader persondata uden approvedDataProcessing`);
      if (!route.processor) problems.push(`modelrouten '${route.id}' tillader persondata uden en godkendt processor`);
      if (!route.dpaRef) problems.push(`modelrouten '${route.id}' tillader persondata uden en databehandleraftale (dpaRef)`);
      if (!isPersonalEntry(entry)) problems.push(`modelrouten '${route.id}' tillader persondata, men registerposten '${entry.id}' erklærer ingen persondatakategori`);
      if (!entry.roles?.processor?.contractRef) problems.push(`modelrouten '${route.id}': registerposten '${entry.id}' mangler en processor-kontraktreference`);
    }
  }

  for (const entry of entries) {
    if (entry.moduleRef && !moduleNames.has(entry.moduleRef)) problems.push(`registerposten '${entry.id}' peger på et ukendt modul '${entry.moduleRef}'`);
    if (entry.routeRef && !routeIds.has(entry.routeRef)) problems.push(`registerposten '${entry.id}' peger på en ukendt route '${entry.routeRef}'`);
    if (!entry.moduleRef && !entry.routeRef) problems.push(`registerposten '${entry.id}' peger hverken på et modul eller en route`);
  }

  return problems;
}

/** Alle poster med en aktiv blocker (typisk manglende ejerbeslutning/aftale). */
export function blockerRows(register) {
  return (register?.entries ?? [])
    .map((entry) => ({ entry, blockers: entryBlockers(entry) }))
    .filter((row) => row.blockers.length > 0);
}

export function loadRegister(path = registerPath) {
  if (!existsSync(path)) throw new Error(`Mangler ${relative(repoRoot, path)}`);
  const register = JSON.parse(readFileSync(path, "utf8"));
  const { ok, errors } = validateDataRegister(register);
  if (!ok) {
    throw new Error(
      "data-register.json matcher ikke kontrakten eller semantikken:\n" +
        errors.map((e) => `  ${(e.path || "/").trim()} ${e.message}`).join("\n")
    );
  }
  const internal = dataRegisterProblems(register);
  if (internal.length) {
    throw new Error("Dataregisteret er inkonsistent:\n" + internal.map((p) => `  ${p.path} ${p.message}`).join("\n"));
  }
  return register;
}

export function renderMarkdown(register) {
  const lines = [];
  lines.push("<!-- GENERERET af compliance/src/data-register-cli.mjs fra compliance/data-register.json. Redigér registeret, ikke denne fil. -->");
  lines.push("");
  lines.push("# Dataregister og retention");
  lines.push("");
  lines.push(register.metadata.description);
  lines.push("");
  lines.push(`Version ${register.metadata.version} · sidst gennemgået ${register.metadata.lastReviewed}.`);
  lines.push("");
  lines.push("Registeret er en påstand om mekanismer, ikke en juridisk vurdering. Behandlingsgrundlaget er et ejerbesluttet felt; manglende beslutning eller aftale markeres som blocker for persondata.");
  lines.push("");

  const blockers = blockerRows(register);
  lines.push("## Blockere");
  lines.push("");
  if (blockers.length === 0) {
    lines.push("Ingen aktive blockere. Alle persondataposter har ejerbesluttet grundlag, databehandleraftale og tredjelandsvurdering.");
  } else {
    lines.push("| Post | Blocker |");
    lines.push("| --- | --- |");
    for (const { entry, blockers: list } of blockers) {
      for (const b of list) lines.push(`| \`${entry.id}\` | ${b} |`);
    }
  }
  lines.push("");

  lines.push("## Registerposter");
  lines.push("");
  lines.push("| Post | Status | Ejer | Formål | Datakategorier | Retention | Placering | Tredjeland |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of register.entries) {
    const purposes = (entry.purposes ?? []).map((p) => p.name).join(", ");
    const retention = entry.retention ? `${entry.retention.maxDays} dage (${entry.retention.version})` : "—";
    const transfer = entry.location?.thirdCountryTransfer;
    const transferText = transfer ? `${transfer.status}${transfer.assessed ? "" : " (ikke vurderet)"}` : "—";
    lines.push(
      `| \`${entry.id}\` | ${entry.status} | ${entry.owner?.name ?? "—"} | ${purposes} | ${(entry.dataCategories ?? []).join(", ")} | ${retention} | ${entry.location?.hostingRegion ?? "—"} | ${transferText} |`
    );
  }
  lines.push("");

  lines.push("## Retention pr. formål");
  lines.push("");
  lines.push("| Post | Formål | Politik | Version | Maks. dage | Udløser | Sletning |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of register.entries) {
    const r = entry.retention;
    if (!r) continue;
    const purpose = (entry.purposes ?? []).find((p) => p.id === r.purposeRef);
    lines.push(`| \`${entry.id}\` | ${purpose?.name ?? r.purposeRef} | \`${r.policyId}\` | ${r.version} | ${r.maxDays} | ${r.trigger} | ${r.deleteMechanism} |`);
  }
  lines.push("");

  lines.push("## Subprocessorer");
  lines.push("");
  lines.push("| Subprocessor | Formål | Placering | Aftale | Tredjeland |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const sp of register.subprocessors ?? []) {
    lines.push(`| \`${sp.id}\` (${sp.name}) | ${sp.purpose} | ${sp.hostingRegion} | ${sp.dpaRef} | ${sp.thirdCountryTransfer?.status ?? "—"} |`);
  }
  lines.push("");

  lines.push("## Databærende artefakter");
  lines.push("");
  lines.push("| Post | Artefakter |");
  lines.push("| --- | --- |");
  for (const entry of register.entries) {
    lines.push(`| \`${entry.id}\` | ${(entry.assets ?? []).map((a) => a.kind).join(", ") || "—"} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function check() {
  const expected = renderMarkdown(loadRegister());
  if (!existsSync(outputPath)) {
    throw new Error(`${relative(repoRoot, outputPath)} mangler. Kør 'make data-register-write'.`);
  }
  const actual = readFileSync(outputPath, "utf8");
  if (actual !== expected) {
    throw new Error(`${relative(repoRoot, outputPath)} er ude af trit med registeret. Kør 'make data-register-write'.`);
  }
}

export { validateDataRegister, dataRegisterProblems, entryBlockers, isPersonalEntry, buildAjv, validate, SCHEMA_IDS };
