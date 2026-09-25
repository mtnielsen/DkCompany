/**
 * DKC-054 — den ene autoritative ønskede tilstand.
 *
 * Der findes kun én ønsket tilstand. Filen, UI'et og API'et redigerer alle
 * samme dokument; en ændring planlægges som et diff, kræver en navngiven
 * menneskelig autorisation bundet til en ramme, og skrives atomisk. Hvis den
 * faktiske tilstand afviger fra den ønskede, rapporteres driften — den skjules
 * ikke, og der gættes aldrig på en tredje kilde.
 */
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeConfiguration, configurationDigest, configurationContentDigest, effectiveSettings } from "./model.mjs";
import { validateConfigurationInput } from "./validate-api.mjs";

function flatten(value, prefix = "", out = {}) {
  if (value === null || typeof value !== "object") {
    out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) flatten(value[i], `${prefix}/${i}`, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) flatten(child, `${prefix}/${key}`, out);
  return out;
}

/** Planlæg forskellen mellem den nuværende og den ønskede tilstand. */
export function planConfigurationChange({ current, desired, scope = "installation" } = {}) {
  const normalizedCurrent = normalizeConfiguration(current ?? {});
  const normalizedDesired = normalizeConfiguration(desired ?? {});
  const currentSettings = scope === "installation" ? normalizedCurrent?.installation ?? {} : effectiveSettings(normalizedCurrent, { tenantId: scope });
  const desiredSettings = scope === "installation" ? normalizedDesired?.installation ?? {} : effectiveSettings(normalizedDesired, { tenantId: scope });
  const from = flatten(currentSettings);
  const to = flatten(desiredSettings);
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  const changes = [];
  for (const key of keys) {
    const a = from[key];
    const b = to[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ path: `/installation${key}`, from: a ?? null, to: b ?? null, scope });
    }
  }
  return {
    ok: changes.length >= 0,
    scope,
    changes,
    requiresHumanApproval: changes.length > 0,
    fromDigest: current ? configurationDigest(current) : null,
    toDigest: desired ? configurationDigest(desired) : null,
  };
}

/** Opdag tavs drift mellem ønsket og faktisk tilstand. */
export function detectDrift({ desired, actual } = {}) {
  const desiredDigest = configurationDigest(desired);
  const actualDigest = actual ? configurationDigest(actual) : null;
  const drift = actualDigest !== desiredDigest;
  const changes = drift ? planConfigurationChange({ current: actual, desired }).changes : [];
  return {
    drift,
    policy: "fail-closed",
    desiredDigest,
    actualDigest,
    changes,
    reason: drift ? "faktisk tilstand afviger fra den ene ønskede tilstand" : null,
  };
}

/**
 * Anvend en ønsket tilstand efter menneskelig autorisation. Returnerer den
 * kanoniske tilstand og dens digest; skriver den atomisk, når `path` er angivet.
 */
export function applyDesiredState({ desired, authorization, path = null, now = Date.now(), ...opts } = {}) {
  const result = validateConfigurationInput(desired, { source: "apply", ...opts });
  if (!result.ok) return { ok: false, errors: result.errors, digest: null };
  const auth = authorization ?? desired?.authorization;

  // Autorisationen skal være en navngiven menneskelig beslutning bundet til det
  // dokument, der faktisk anvendes.
  if (!auth || !/^[a-z][a-z0-9-]*\|/.test(auth.humanSubject ?? "")) {
    return { ok: false, errors: [{ path: "/authorization", message: "ændringen kræver en navngiven menneskelig autorisation", kind: "authorization" }], digest: null };
  }
  if (auth.decisionDigest && auth.decisionDigest !== configurationContentDigest(desired)) {
    return { ok: false, errors: [{ path: "/authorization/decisionDigest", message: "autorisationens digest matcher ikke dokumentet", kind: "authorization" }], digest: null };
  }
  const expires = Date.parse(auth.expiresAt ?? "");
  if (Number.isFinite(expires) && expires <= now) {
    return { ok: false, errors: [{ path: "/authorization/expiresAt", message: "autorisationen er udløbet", kind: "authorization" }], digest: null };
  }

  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(result.normalized, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  }
  return { ok: true, errors: [], state: result.normalized, digest: result.digest };
}

export function readDesiredState(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(join(path), "utf8"));
}
