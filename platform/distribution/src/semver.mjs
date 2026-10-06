/**
 * DKC-053 — minimal, dependency-fri SemVer 2.0.0-parser og range-satisfaction.
 *
 * Modulet er bevidst uden npm-afhængigheder, så installation og resolver kan
 * køre i en ren Node uden `npm install`. Det understøtter de intervaller
 * katalogmanifestet bruger:
 *
 *   - eksakt:           1.2.3            =1.2.3
 *   - sammenligning:    >=1.2.3  <2.0.0  >1.0.0  <=2.0.0
 *   - caret:            ^1.2.3           (>=1.2.3 <2.0.0, med 0.x-særregler)
 *   - tilde:            ~1.2.3           (>=1.2.3 <1.3.0)
 *   - delvis:           1.2  >=1.2  1   1.x
 *   - union:            1.2.3 || >=2.0.0
 *   - any:              *  x  X
 *
 * En version uden range behandles som et eksakt krav. Et tomt range er "any".
 */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function splitPrerelease(value) {
  if (!value) return [];
  return value.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** Parse en komplet SemVer-streng. Returnerer null for ugyldigt input. */
export function parseVersion(input) {
  if (typeof input !== "string") return null;
  const match = VERSION_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: splitPrerelease(match[4]),
    build: match[5] ?? null,
    raw: input.trim(),
  };
}

/** True hvis input er en gyldig, komplet SemVer. */
export function isValidVersion(input) {
  return parseVersion(input) !== null;
}

function comparePrerelease(a, b) {
  // En version med prerelease er lavere end den tilsvarende uden.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum) return x < y ? -1 : 1;
    if (xNum) return -1;
    if (yNum) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Sammenlign to SemVer-strenge eller -objekter. -1, 0 eller 1. */
export function compareVersions(a, b) {
  const va = typeof a === "string" ? parseVersion(a) : a;
  const vb = typeof b === "string" ? parseVersion(b) : b;
  if (!va || !vb) throw new Error(`Ugyldig version: ${typeof a === "string" ? a : JSON.stringify(a)} / ${typeof b === "string" ? b : JSON.stringify(b)}`);
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return comparePrerelease(va.prerelease, vb.prerelease);
}

export function formatVersion(version) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  if (!v) throw new Error(`Ugyldig version: ${version}`);
  const pre = v.prerelease.length ? `-${v.prerelease.join(".")}` : "";
  const build = v.build ? `+${v.build}` : "";
  return `${v.major}.${v.minor}.${v.patch}${pre}${build}`;
}

function parseLoose(raw) {
  const text = raw.trim();
  if (text === "" || text === "*" || /^x$/i.test(text)) return { any: true };
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!m) return null;
  const wildcard = m[2] === undefined || m[3] === undefined || /^x$/i.test(m[2]) || /^x$/i.test(m[3]);
  return {
    major: Number(m[1]),
    minor: m[2] === undefined || /^x$/i.test(m[2]) ? 0 : Number(m[2]),
    patch: m[3] === undefined || /^x$/i.test(m[3]) ? 0 : Number(m[3]),
    prerelease: splitPrerelease(m[4]),
    hasMinor: m[2] !== undefined && !/^x$/i.test(m[2]),
    hasPatch: m[3] !== undefined && !/^x$/i.test(m[3]),
    wildcard,
  };
}

function cmp(version, loose, op) {
  const V = {
    major: loose.major,
    minor: loose.minor,
    patch: loose.patch,
    prerelease: loose.prerelease,
    build: null,
  };
  const c = compareVersions(version, V);
  switch (op) {
    case ">": return c > 0;
    case ">=": return c >= 0;
    case "<": return c < 0;
    case "<=": return c <= 0;
    case "=": return c === 0;
    default: throw new Error(`Ukendt operator: ${op}`);
  }
}

function parseComparator(term) {
  const text = term.trim();
  if (text === "" || text === "*" || /^x$/i.test(text)) return () => true;

  let op = "=";
  let rest = text;
  const opMatch = /^(>=|<=|>|<|=|\^|~)/.exec(text);
  if (opMatch) {
    op = opMatch[1];
    rest = text.slice(op.length).trim();
  }
  const loose = parseLoose(rest);
  if (!loose) return null;
  if (loose.any) return () => true;

  if (op === "=") {
    if (loose.wildcard) {
      // Delvis version: 1.2 betyder >=1.2.0 <1.3.0, 1 betyder >=1.0.0 <2.0.0.
      if (!loose.hasMinor) return (v) => v.major === loose.major;
      if (!loose.hasPatch) return (v) => v.major === loose.major && v.minor === loose.minor;
      return (v) => cmp(v, loose, "=");
    }
    return (v) => cmp(v, loose, "=");
  }
  if (op === "^") {
    const lower = (v) => cmp(v, loose, ">=");
    let upper;
    if (loose.major > 0) upper = (v) => v.major === loose.major;
    else if (loose.minor > 0) upper = (v) => v.major === 0 && v.minor === loose.minor;
    else upper = (v) => v.major === 0 && v.minor === 0 && v.patch === loose.patch;
    if (loose.wildcard || !loose.hasMinor) {
      // ^1 eller ^1.x: >=1.0.0 <2.0.0
      return (v) => v.major === loose.major;
    }
    if (!loose.hasPatch) {
      // ^1.2 => >=1.2.0 <2.0.0 (major>0), ^0.2 => >=0.2.0 <0.3.0
      if (loose.major > 0) return (v) => v.major === loose.major;
      return (v) => v.major === 0 && v.minor === loose.minor;
    }
    return (v) => lower(v) && upper(v);
  }
  if (op === "~") {
    if (!loose.hasMinor) return (v) => v.major === loose.major;
    if (!loose.hasPatch) return (v) => v.major === loose.major && v.minor === loose.minor;
    return (v) => cmp(v, loose, ">=") && v.major === loose.major && v.minor === loose.minor;
  }
  return (v) => cmp(v, loose, op);
}

/**
 * True hvis versionen opfylder intervallet. Kaster på et ugyldigt interval,
 * så en tastefejl i et manifest ikke stille og roligt afvises.
 */
export function satisfies(version, range) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  if (!v) return false;
  if (range === undefined || range === null || String(range).trim() === "") return true;
  const sets = String(range).split("||");
  for (const set of sets) {
    const terms = set.trim().split(/\s+/).filter(Boolean);
    let ok = true;
    for (const term of terms) {
      const predicate = parseComparator(term);
      if (!predicate) throw new Error(`Ugyldigt versionsinterval: '${range}' (ved '${term}')`);
      if (!predicate(v)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Højeste version fra en liste der opfylder intervallet, eller null. */
export function maxSatisfying(versions, range) {
  const candidates = versions.filter((v) => satisfies(v, range));
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareVersions).at(-1);
}

/** True hvis intervallet overhovedet er gyldigt (kan parses). */
export function isValidRange(range) {
  try {
    // Et vilkårligt gyldigt datapunkt tvinger parseren igennem alle led.
    satisfies("0.0.0", range);
    return true;
  } catch {
    return false;
  }
}
