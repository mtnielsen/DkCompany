/**
 * DKC-023 — versionsforhandling mellem adapter og upstream.
 *
 * Et upstream-produkt ændrer API mellem versioner og editions. En adapter må
 * ikke antage, at "nyeste" virker:
 *
 *   - `parseVersion`/`compareVersions` giver en deterministisk orden,
 *   - `satisfiesRange` understøtter de intervaller et releaseprofil må erklære
 *     (`^`, `~`, `>=`, `<=`, `<`, `>`, `=`, eksakt og `*`, kombineret med
 *     mellemrum og `||`),
 *   - `negotiateUpstreamVersion` svarer `supported`, `degraded` eller
 *     `unsupported` og begrunder hvorfor. En uafklaret edition er ikke "måske".
 *
 * Validatorerne er rene funktioner uden netværk.
 */

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(value) {
  const match = VERSION_RE.exec(String(value ?? "").trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

export function compareVersions(a, b) {
  const pa = typeof a === "string" ? parseVersion(a) : a;
  const pb = typeof b === "string" ? parseVersion(b) : b;
  if (!pa || !pb) throw new Error(`kan ikke sammenligne ugyldige versioner: '${a}' og '${b}'`);
  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  // Et prerelease er lavere end selve versionen.
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) return pa.prerelease === pb.prerelease ? 0 : pa.prerelease < pb.prerelease ? -1 : 1;
  return 0;
}

function upperBoundForCaret(v) {
  if (v.major > 0) return `${v.major + 1}.0.0`;
  if (v.minor > 0) return `0.${v.minor + 1}.0`;
  return `0.0.${v.patch + 1}`;
}

function upperBoundForTilde(v) {
  return `${v.major}.${v.minor + 1}.0`;
}

/** Matcher én kommasepareret komparatorgruppe (mellemrum = AND). */
function satisfiesConjunction(version, conjunction) {
  const terms = conjunction.trim().split(/\s+/).filter(Boolean);
  for (const term of terms) {
    if (term === "*" || term === "x" || term === "latest") continue;
    let m;
    if ((m = /^\^(.+)$/.exec(term))) {
      const base = parseVersion(m[1]);
      if (!base) return false;
      if (compareVersions(version, base) < 0) return false;
      if (compareVersions(version, parseVersion(upperBoundForCaret(base))) >= 0) return false;
    } else if ((m = /^~(.+)$/.exec(term))) {
      const base = parseVersion(m[1]);
      if (!base) return false;
      if (compareVersions(version, base) < 0) return false;
      if (compareVersions(version, parseVersion(upperBoundForTilde(base))) >= 0) return false;
    } else if ((m = /^(>=|<=|>|<|=)(.+)$/.exec(term))) {
      const base = parseVersion(m[2]);
      if (!base) return false;
      const cmp = compareVersions(version, base);
      if (m[1] === ">=" && cmp < 0) return false;
      if (m[1] === "<=" && cmp > 0) return false;
      if (m[1] === ">" && cmp <= 0) return false;
      if (m[1] === "<" && cmp >= 0) return false;
      if (m[1] === "=" && cmp !== 0) return false;
    } else {
      const base = parseVersion(term);
      if (!base) return false;
      if (compareVersions(version, base) !== 0) return false;
    }
  }
  return true;
}

/** Sand hvis `version` matcher `range` (samme syntaks som negotieringsfelterne). */
export function satisfiesRange(version, range) {
  const parsed = typeof version === "string" ? parseVersion(version) : version;
  if (!parsed) return false;
  return String(range)
    .split("||")
    .some((part) => satisfiesConjunction(parsed, part));
}

/**
 * Forhandl upstream-version og edition mod et releaseprofil.
 *
 * @returns {{status: "supported"|"degraded"|"unsupported", reason: string,
 *            version: string|null, edition: string|null, matchedRange: string|null}}
 */
export function negotiateUpstreamVersion({
  upstreamVersion,
  edition = null,
  supportedRanges = [],
  supportedEditions = [],
  onUnsupported = "refuse",
} = {}) {
  const parsed = parseVersion(upstreamVersion);
  if (!parsed) {
    return { status: "unsupported", reason: `ukendt upstream-version '${upstreamVersion ?? ""}'`, version: upstreamVersion ?? null, edition, matchedRange: null };
  }
  if (supportedEditions.length && edition && !supportedEditions.includes(edition)) {
    return { status: "unsupported", reason: `edition '${edition}' er ikke understøttet (${supportedEditions.join(", ")})`, version: upstreamVersion, edition, matchedRange: null };
  }
  const matchedRange = supportedRanges.find((range) => satisfiesRange(parsed, range)) ?? null;
  if (!matchedRange) {
    return {
      status: onUnsupported === "degrade" ? "degraded" : "unsupported",
      reason: `version '${upstreamVersion}' matcher ingen understøttet serie (${supportedRanges.join(", ") || "ingen"})`,
      version: upstreamVersion,
      edition,
      matchedRange: null,
    };
  }
  return { status: "supported", reason: `version '${upstreamVersion}' matcher '${matchedRange}'`, version: upstreamVersion, edition, matchedRange };
}

/** Bekvemmelighed: kast hvis resultatet ikke er `supported` og politikken kræver det. */
export function assertNegotiated(result, { allowDegraded = false } = {}) {
  if (result.status === "supported") return result;
  if (result.status === "degraded" && allowDegraded) return result;
  const err = new Error(result.reason);
  err.code = "version_unsupported";
  err.negotiation = result;
  throw err;
}
