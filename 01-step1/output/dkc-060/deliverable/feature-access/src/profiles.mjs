/**
 * DKC-060 — funktionsprofiler.
 *
 * En funktionsprofil binder en valgfri funktionspakke til ét separat formål,
 * et sæt moduler, tilladte dataklasser og default-deny-felt-/rækkeregler.
 * Profilerne er ren data; håndhævelsen ligger i access.mjs.
 *
 * Semantikken ud over JSON Schema:
 *   - profilen skal være en af de fire kendte funktioner,
 *   - platform-core skal være valgt,
 *   - alle syv flader skal være dækket, så én flade ikke kan undgå kontrollen,
 *   - et følsomt/særligt felt må kun tillades med en eksplicit bevilling,
 *   - en ekstern skrivekilde kræver en begrundelse,
 *   - en ekstern modtager skal revalideres både ved kørsel og afsendelse,
 *   - formålene skal være indbyrdes forskellige.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_IDS, SURFACES, GRANT_REQUIRED_FIELD_CLASSES } from "./constants.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const defaultProfilesDir = join(here, "..", "profiles");

const TEAM_SCHEMES = new Set(["team", "group", "role", "bot", "agent", "service"]);

export function isNamedHuman(owner) {
  if (!owner || typeof owner.subject !== "string") return false;
  const [scheme, ...rest] = owner.subject.split("|");
  const id = rest.join("|").trim();
  if (!id || id.length < 3) return false;
  if (TEAM_SCHEMES.has((scheme ?? "").toLowerCase())) return false;
  return Boolean(owner.name && owner.name.trim().length >= 2 && owner.role && owner.role.trim().length >= 2);
}

function err(path, message) {
  return { path, message };
}

export function loadProfiles(dir = defaultProfilesDir) {
  if (!existsSync(dir)) return [];
  const profiles = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    profiles.push({ __file: file, ...data });
  }
  return profiles;
}

export function indexProfiles(profiles = []) {
  const map = {};
  for (const profile of profiles) map[profile.id] = profile;
  return map;
}

/** Semantiske problemer for én profil (skemaet håndhæver formen). */
export function featureProfileProblems(profile) {
  const problems = [];
  if (!profile || typeof profile !== "object") return [err("/", "profilen er ikke et objekt")];
  if (!FEATURE_IDS.includes(profile.id)) problems.push(err("/id", `ukendt funktion '${profile.id}'`));
  if (!isNamedHuman(profile.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "profilen skal have et navngivet menneske som ejer, ikke et team-alias"));
  }
  const purpose = (profile.purpose ?? "").trim();
  if (!purpose) problems.push(err("/purpose", "profilen mangler et formål"));

  const modules = profile.modules ?? [];
  if (!modules.includes("platform-core")) problems.push(err("/modules", "profilen skal medtage platform-core (sikkerhedskernen)"));

  const surfaces = new Set(profile.surfaces ?? []);
  for (const surface of SURFACES) if (!surfaces.has(surface)) problems.push(err("/surfaces", `profilen mangler fladen '${surface}' — en udeladt flade er en ukontrolleret flade`));

  const fieldRules = profile.fieldRules ?? {};
  if ((fieldRules.defaultDecision ?? "deny") !== "deny") problems.push(err("/fieldRules/defaultDecision", "feltreglerne skal være default-deny"));
  const seenFields = new Set();
  for (const [i, rule] of (fieldRules.fields ?? []).entries()) {
    const at = `/fieldRules/fields/${i}`;
    if (seenFields.has(rule.field)) problems.push(err(`${at}/field`, `feltet '${rule.field}' er erklæret flere gange`));
    seenFields.add(rule.field);
    if (GRANT_REQUIRED_FIELD_CLASSES.includes(rule.dataClass) && rule.decision === "allow" && !rule.requiresGrant) {
      problems.push(err(`${at}/requiresGrant`, `det beskyttede felt '${rule.field}' (${rule.dataClass}) må ikke tillades uden en eksplicit bevilling`));
    }
    if (rule.dataClass === "special-category" && rule.decision === "allow" && !rule.requiresGrant) {
      problems.push(err(`${at}/requiresGrant`, `særlige kategorier kræver altid en formålsbestemt bevilling`));
    }
    if (rule.decision === "redact" && rule.dataClass === "public") {
      problems.push(err(`${at}/decision`, `et offentligt felt '${rule.field}' kan ikke være tilbageholdt`));
    }
  }

  for (const [i, source] of (profile.externalSources ?? []).entries()) {
    const at = `/externalSources/${i}`;
    if (source.access === "write" && !(source.note ?? "").trim()) {
      problems.push(err(`${at}/note`, `den eksterne skrivekilde '${source.id}' kræver en begrundelse og et aftalt scope`));
    }
    if (source.connectorRequired === true && source.access === "write") {
      problems.push(err(`${at}/access`, `connectoren til '${source.id}' er read-only som standard og må ikke erklæres skrivende her`));
    }
  }

  for (const [i, trust] of (profile.recipientTrust ?? []).entries()) {
    const at = `/recipientTrust/${i}`;
    const at2 = new Set(trust.revalidateAt ?? []);
    if (trust.kind === "external" && (!at2.has("run") || !at2.has("delivery"))) {
      problems.push(err(`${at}/revalidateAt`, `den eksterne modtager '${trust.id}' skal revalideres både ved kørsel og afsendelse`));
    }
    if (!trust.dataSharingRef) problems.push(err(`${at}/dataSharingRef`, `modtageren '${trust.id}' mangler en datadelingsreference`));
  }
  return problems;
}

/** Samlede profilproblemer, inkl. at formålene skal være forskellige. */
export function featureProfilesProblems(profiles = []) {
  const problems = [];
  const byPurpose = new Map();
  const ids = new Set();
  for (const profile of profiles) {
    const file = profile.__file ?? profile.id ?? "?";
    if (ids.has(profile.id)) problems.push(`${file}: dubleret funktions-id '${profile.id}'`);
    ids.add(profile.id);
    for (const p of featureProfileProblems(profile)) problems.push(`${file}${p.path}: ${p.message}`);
    const purpose = (profile.purpose ?? "").trim();
    if (purpose) {
      if (byPurpose.has(purpose)) problems.push(`${file}: formålet '${purpose}' deles med '${byPurpose.get(purpose)}' — formålene skal være adskilte`);
      else byPurpose.set(purpose, file);
    }
  }
  for (const id of FEATURE_IDS) if (!ids.has(id)) problems.push(`funktionsprofilen '${id}' mangler`);
  return problems;
}
