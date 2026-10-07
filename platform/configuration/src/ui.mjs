/**
 * DKC-054 — fælles UI/API-flade for konfigurationen.
 *
 * Portalen og den deklarative fil bruger præcis samme validerings-API. Denne
 * flade viser ønsket og faktisk tilstand side om side, markerer tavs drift og
 * afviser en indsendelse med de samme fejl, som filen ville give. Der er ingen
 * separat UI-sandhed.
 */
import { validateSubmission } from "./validate-api.mjs";
import { detectDrift, planConfigurationChange } from "./desired-state.mjs";
import { effectiveSettings } from "./model.mjs";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const RENDERED_FIELDS = ["logLevel", "debug", "backups", "resourceLimits"];

export function configurationApi({ desired, actual } = {}) {
  const drift = detectDrift({ desired, actual });
  return {
    desiredState: desired ?? null,
    actualState: actual ?? null,
    drift,
    effective: desired ? effectiveSettings(desired) : null,
    singleSource: true,
  };
}

/**
 * Behandl en indsendelse fra UI eller API. Resultatet er identisk med den
 * effekt, en tilsvarende filændring ville have: samme digest, samme fejl.
 */
export function handleConfigurationSubmission({ source = "portal", payload, desired, ...opts } = {}) {
  const validation = validateSubmission({ source, payload, ...opts });
  if (!validation.ok) return { ok: false, errors: validation.errors, digest: null, applied: false };
  const change = planConfigurationChange({ current: desired, desired: validation.normalized });
  return {
    ok: true,
    errors: [],
    digest: validation.digest,
    applied: change.changes.length > 0,
    change,
    state: validation.normalized,
  };
}

/** Server-rendered visning af ønsket vs. faktisk tilstand. */
export function renderConfigurationView({ desired, actual, validation = null, lang = "da" } = {}) {
  const drift = detectDrift({ desired, actual });
  const effective = desired ? effectiveSettings(desired) : {};
  const rows = RENDERED_FIELDS.map((field) => {
    const want = effective[field];
    const have = actual ? effectiveSettings(actual)[field] : null;
    const same = JSON.stringify(want) === JSON.stringify(have);
    return `<tr><th>${escapeHtml(field)}</th><td>${escapeHtml(JSON.stringify(want))}</td><td${same ? "" : ' class="drift"'}>${escapeHtml(JSON.stringify(have))}</td></tr>`;
  }).join("");
  const errors = validation && !validation.ok ? `<ul>${validation.errors.map((e) => `<li>${escapeHtml(`${e.path} ${e.message}`)}</li>`).join("")}</ul>` : "";
  const banner = drift.drift ? `<p class="drift">Drift: ${escapeHtml(drift.reason)}</p>` : "<p>Ønsket og faktisk tilstand er i sync.</p>";
  return [
    `<section aria-labelledby="config-heading" lang="${escapeHtml(lang)}">`,
    `<h2 id="config-heading">Konfiguration (én ønsket tilstand)</h2>`,
    banner,
    errors,
    `<table><caption>Ønsket vs. faktisk</caption><thead><tr><th>Felt</th><th>Ønsket</th><th>Faktisk</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<p>Ændringer kræver menneskelig autorisation og skrives gennem den ene autoritative ønskede tilstand.</p>`,
    `</section>`,
  ].join("");
}
