/**
 * DKC-017 — friskhed og sikkerhedsstatus.
 *
 * Et grønt sikkerhedsstatusfelt må kun betyde «et frisk bevis siger pass». En
 * gammel eller manglende sensordata må derfor aldrig arve et grønt lys fra en
 * tidligere kørsel. Modulet gør den regel eksplicit og deterministisk:
 *
 *   - `freshnessFor` afgør om en måling er `fresh`, `stale` eller `missing` ud
 *     fra dens `capturedAt` og sensorens `maxAgeSeconds`,
 *   - `statusForReading` oversætter friskhed + fundstatus til én status, hvor
 *     `stale`/`missing` altid er ikke-grønne,
 *   - `overallStatus` vælger den mest alvorlige status i et sæt.
 *
 * Ren funktion, så grænsetilfælde (udløb, manglende tid, ur-tilbagegang) kan
 * efterprøves uden en kørende backend.
 */

export const FRESHNESS = {
  fresh: { label: "Frisk", green: true, description: "Målingen er inden for sensorens maksimale alder" },
  stale: { label: "Forældet", green: false, description: "Målingen er ældre end sensorens maksimale alder" },
  missing: { label: "Mangler", green: false, description: "Der findes ingen måling for sensoren" },
};

export const FRESHNESS_NAMES = Object.keys(FRESHNESS);

/** Ikke-grønne statusser, som en sikkerhedsstatus aldrig må skjule som grøn. */
export const NON_GREEN_STATUSES = new Set(["partial", "fail", "stale", "missing", "unknown"]);

function asMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

/** Alder i sekunder, eller `null` når tidsstemplet mangler/er ugyldigt. */
export function ageSeconds(capturedAt, now = Date.now()) {
  const captured = asMillis(capturedAt);
  const at = asMillis(now);
  if (!Number.isFinite(captured) || !Number.isFinite(at)) return null;
  return Math.max(0, Math.round((at - captured) / 1000));
}

/**
 * Friskhed for én måling.
 *
 * Et fremtidigt tidsstempel behandles som frisk, men et manglende/ugyldigt
 * tidsstempel er altid `missing` — ikke «frisk» fordi der ikke er en alder.
 */
export function freshnessFor({ capturedAt, maxAgeSeconds, now = Date.now() } = {}) {
  if (capturedAt === undefined || capturedAt === null || capturedAt === "") {
    return { freshness: "missing", ageSeconds: null, maxAgeSeconds: maxAgeSeconds ?? null, reason: "målingen har intet tidsstempel" };
  }
  const captured = asMillis(capturedAt);
  const at = asMillis(now);
  if (!Number.isFinite(captured)) {
    return { freshness: "missing", ageSeconds: null, maxAgeSeconds: maxAgeSeconds ?? null, reason: "tidsstemplet er ugyldigt" };
  }
  if (!Number.isFinite(at)) {
    return { freshness: "missing", ageSeconds: null, maxAgeSeconds: maxAgeSeconds ?? null, reason: "referencetiden er ugyldig" };
  }
  const age = Math.max(0, Math.round((at - captured) / 1000));
  if (!Number.isFinite(maxAgeSeconds)) {
    return { freshness: "fresh", ageSeconds: age, maxAgeSeconds: null, reason: "sensoren har ingen maksimal alder" };
  }
  if (age > maxAgeSeconds) {
    return { freshness: "stale", ageSeconds: age, maxAgeSeconds, reason: `målingen er ${age}s gammel (grænse ${maxAgeSeconds}s)` };
  }
  return { freshness: "fresh", ageSeconds: age, maxAgeSeconds, reason: null };
}

/**
 * Oversæt friskhed + fundstatus til den status en sikkerhedsvisning må vise.
 * `stale` og `missing` tilsidesætter enhver fundstatus — også et tidligere
 * `pass`.
 */
export function statusForReading({ freshness, findingsStatus = null } = {}) {
  if (freshness === "missing") return "missing";
  if (freshness === "stale") return "stale";
  if (findingsStatus === null || findingsStatus === undefined) return "unknown";
  return findingsStatus;
}

const SEVERITY = { fail: 5, partial: 4, stale: 3, missing: 2, unknown: 1, pass: 0 };

/** Den mest alvorlige status i et sæt. Tomt sæt giver `unknown` (ikke `pass`). */
export function overallStatus(statuses = []) {
  const list = statuses.filter((s) => s !== undefined && s !== null);
  if (list.length === 0) return "unknown";
  let worst = "pass";
  for (const status of list) {
    if ((SEVERITY[status] ?? 1) > (SEVERITY[worst] ?? 0)) worst = status;
  }
  return worst;
}

/** Sandt kun når statussen er et frisk, grønt `pass`. */
export function isGreen(status) {
  return status === "pass";
}

/** Sandt når statussen er forældet eller manglende. */
export function isStaleOrMissing(status) {
  return status === "stale" || status === "missing";
}
