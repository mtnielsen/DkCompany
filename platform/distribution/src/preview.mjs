#!/usr/bin/env node
/**
 * DKC-053 — deterministisk installationspreview.
 *
 *   node distribution/src/preview.mjs --profile small-vps --apps bi [--json]
 *
 * Previewet er deterministisk: samme katalog, profil og valg giver byte-for-byte
 * samme output. Det viser den valgte closure, hvorfor hver komponent er
 * nødvendig, installationsrækkefølgen, ressourceforbrug mod profilens budget,
 * download-/driftskrav, datatjenester og migrationer — og ALLE fejl der ville
 * stoppe installationen før mutation.
 */
import { pathToFileURL } from "node:url";
import { loadComponents, loadProfiles, loadPlatforms, loadDeploymentProfiles } from "./catalog.mjs";
import { findProfile, findDeploymentProfile, currentPlatformId } from "./profiles.mjs";
import { resolveDependencies } from "./resolver.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

export function buildPreview({ profileName, apps = [], includeDefaults = true, lock = {}, removed = [], components, profiles, platforms, deploymentProfiles, serviceClasses }) {
  const profile = findProfile(profiles, profileName);
  if (!profile) throw new Error(`Ukendt installationsprofil: '${profileName}'`);
  const deploymentProfile = findDeploymentProfile(deploymentProfiles, profile.deploymentProfileRef);
  const result = resolveDependencies({
    components,
    profile,
    selection: apps,
    deploymentProfile,
    serviceClasses,
    lock,
    removed,
    includeDefaults,
  });
  const platformId = currentPlatformId(platforms);
  return { profile, deploymentProfile, platformId, result };
}

export function renderPreview({ profile, platformId, result }) {
  const lines = [];
  lines.push("# Installationspreview (DKC-053)");
  lines.push("");
  lines.push(`**Profil:** \`${profile.metadata.name}\` (${profile.profileType}) · version ${profile.metadata.version}`);
  lines.push(`**Sikkerhedskerne:** ${profile.securityCore.join(", ")}`);
  lines.push(`**Platform (denne maskine):** \`${platformId ?? "ukendt"}\` · understøttede: ${profile.supportedPlatforms.map((p) => `\`${p}\``).join(", ")}`);
  lines.push(`**Resultat:** ${result.ok ? "KLAR" : "STOPPET FØR MUTATION"}`);
  lines.push("");

  if (result.errors.length) {
    lines.push("## Fejl (blokerer installation)");
    lines.push("");
    for (const e of result.errors) lines.push(`- **${e.code}** ${e.message}${e.path ? ` (\`${e.path}\`)` : ""}`);
    lines.push("");
  }
  if (result.warnings.length) {
    lines.push("## Advarsler");
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  if (result.safety?.errors?.length) {
    lines.push("## Profil-/serviceklassekontrol");
    lines.push("");
    for (const e of result.safety.errors) lines.push(`- **${e.code}** ${e.message}`);
    lines.push("");
  }

  lines.push("## Valgt closure og hvorfor");
  lines.push("");
  lines.push("| Komponent | Version | Oprindelse | Nødvendig fordi |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of result.entries) {
    const why = entry.reasons.map((r) => `${r.by}: ${r.reason}`).join("<br>") || "—";
    lines.push(`| \`${entry.id}\` | ${entry.version} | ${entry.origin} | ${why} |`);
  }
  lines.push("");

  lines.push("## Installationsrækkefølge");
  lines.push("");
  lines.push(result.order.map((id, i) => `${i + 1}. \`${id}\``).join("\n") || "—");
  lines.push("");

  lines.push("## Ressourcer");
  lines.push("");
  lines.push("| Ressource | Krævet | Profilbudget |");
  lines.push("| --- | --- | --- |");
  const cap = profile.capacity ?? {};
  lines.push(`| CPU (millicores) | ${result.resources.cpuMillicores} | ${cap.cpuMillicores ?? "?"} |`);
  lines.push(`| Hukommelse (MiB) | ${result.resources.memoryMiB} | ${cap.memoryMiB ?? "?"} |`);
  lines.push(`| Lager (GiB) | ${result.resources.storageGiB} | ${cap.storageGiB ?? "?"} |`);
  lines.push(`| Knuder | ${result.resources.nodes} | ${cap.nodes ?? "?"} |`);
  lines.push("");

  lines.push(`## Download (${result.downloadTotalMiB} MiB i alt)`);
  lines.push("");
  if (result.downloads.length === 0) {
    lines.push("Ingen download-krav.");
  } else {
    lines.push("| Komponent | Artefakt | MiB | Verificeret |");
    lines.push("| --- | --- | --- | --- |");
    for (const dl of result.downloads) lines.push(`| \`${dl.component}\` | ${dl.artifact} | ${dl.sizeMiB} | ${dl.verified ? "ja" : "nej"} |`);
  }
  lines.push("");

  lines.push("## Driftskrav (ops-verber)");
  lines.push("");
  lines.push(result.operations.map((o) => `\`${o}\``).join(", ") || "—");
  lines.push("");

  lines.push("## Datatjenester");
  lines.push("");
  if (result.dataServices.length === 0) {
    lines.push("Ingen.");
  } else {
    lines.push("| Datatjeneste | Type | Påkrævet | Provider | Krævet af |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const ds of result.dataServices) {
      lines.push(`| \`${ds.id}\` | ${ds.kind} | ${ds.required ? "ja" : "nej"} | ${ds.providedBy.join(", ") || "—"} | ${ds.requiredBy.map((r) => r.component).join(", ") || "—"} |`);
    }
  }
  lines.push("");

  lines.push("## Migrationer (rækkefølge)");
  lines.push("");
  if (result.migrations.length === 0) {
    lines.push("Ingen.");
  } else {
    lines.push("| Fase | Komponent | Id | Reversibel |");
    lines.push("| --- | --- | --- | --- |");
    for (const m of result.migrations) lines.push(`| ${m.phase} | \`${m.component}\` | ${m.id} | ${m.reversible ? "ja" : "nej"} |`);
  }
  lines.push("");
  lines.push("> Et preview er en plan, ikke en installation. Faktiske data skrives først efter en grøn plan.");
  lines.push("");
  return lines.join("\n");
}

export function parseArgs(argv) {
  const args = { profile: "small-vps", apps: [], json: false, includeDefaults: true, removed: [], lock: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") args.profile = argv[++i];
    else if (a === "--apps") args.apps = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--removed") args.removed = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--lock") {
      const [id, version] = argv[++i].split("=");
      args.lock[id] = version;
    } else if (a === "--no-defaults") args.includeDefaults = false;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Brug: node distribution/src/preview.mjs [--profile navn] [--apps a,b] [--no-defaults] [--removed x] [--lock id=1.2.3] [--json]");
    return;
  }
  const preview = buildPreview({
    profileName: args.profile,
    apps: args.apps,
    includeDefaults: args.includeDefaults,
    lock: args.lock,
    removed: args.removed,
    components: loadComponents(),
    profiles: loadProfiles(),
    platforms: loadPlatforms().platforms,
    deploymentProfiles: loadDeploymentProfiles(),
    serviceClasses: loadServiceClasses(),
  });
  if (args.json) {
    process.stdout.write(JSON.stringify({ profile: preview.profile.metadata.name, deploymentProfile: preview.deploymentProfile?.metadata?.name ?? null, platformId: preview.platformId, result: preview.result }, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderPreview(preview) + "\n");
  process.exitCode = preview.result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
