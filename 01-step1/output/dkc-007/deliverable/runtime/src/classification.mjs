/**
 * DKC-007 — fælles klassifikation af muterende verber og beskyttede A4-ressourcer.
 *
 * Klassifikationen er den ene kilde, som både runtimen og konformanssuiten
 * bruger. To egenskaber er afgørende:
 *
 *   1. Den er **default-muterende**: ethvert verbum, der ikke står på en
 *      udtømmende liste over læsende verber, regnes som muterende. Et nyt
 *      verbum (`upgrade.hotfix`, `config.rollback`, …) kan derfor ikke smutte
 *      gennem A4-kontrollen ved ikke at stå på en gammel liste.
 *   2. Mål normaliseres, før de matches: case, Unicode, procent-encoding,
 *      separatorer, `.`/`..`-segmenter og aliaser. `POLICY/Bundles`,
 *      `policy%2Fbundles`, `policy/./bundles` og `audit_service` er samme
 *      beskyttede ressource.
 */

/** Verber der beviseligt kun læser/tørrer. Alt andet er muterende. */
export const READ_ONLY_VERBS = new Set([
  "observe.read",
  "observe.correlate",
  "diagnose",
  "propose",
  "upgrade.dry-run",
  "verify-restore",
  "health",
  "slo",
  "subject.locate",
  "retention.policy",
  "backup",
]);

/** Bekendte muterende verber — dokumentation; klassifikationen afhænger ikke af listen. */
export const KNOWN_MUTATING_VERBS = new Set([
  "restart",
  "scale",
  "rotate-credential",
  "drain",
  "upgrade",
  "upgrade.patch",
  "upgrade.minor",
  "upgrade.major",
  "config.apply",
  "restore",
  "migrate",
  "migrate.schema",
  "rollback",
  "subject.erase",
  "subject.export",
  "subject.legal_hold",
]);

/**
 * Rødder der altid er A4-beskyttede: policy, audit, governance, rettigheder,
 * nøgler og gates. Sammenligningen sker på normaliserede segmenter.
 */
export const PROTECTED_ROOTS = new Set([
  "policy",
  "policies",
  "policybundles",
  "policybundle",
  "audit",
  "auditlog",
  "auditservice",
  "audittrail",
  "governance",
  "rights",
  "permissions",
  "rbac",
  "iam",
  "auth",
  "authorization",
  "keys",
  "signingkeys",
  "keymaterial",
  "secrets",
  "credentials",
  "guardrails",
  "gates",
  "a4",
]);

/** Decode procent-encoding så langt det giver mening, uden at kaste. */
function decodeFully(value) {
  let current = String(value ?? "").trim();
  for (let i = 0; i < 5; i += 1) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      break;
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Normalisér et mål/ressource-ID: Unicode NFKC, encode-decode, backslash til
 * slash, kollaps af separatorer og `.`/`..`-segmenter, små bogstaver.
 */
export function normalizeResource(value) {
  let s = decodeFully(value).normalize("NFKC");
  s = s.replace(/\\/g, "/");
  s = s.replace(/\/+/g, "/");
  const parts = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/").toLowerCase();
}

/** Er verbet muterende? Ukendte verber regnes som muterende (fail-safe). */
export function isMutatingVerb(verb) {
  const v = String(verb ?? "").trim().toLowerCase();
  if (!v) return false;
  if (READ_ONLY_VERBS.has(v)) return false;
  return true;
}

/**
 * Er målet en A4-beskyttet ressource? Matcher på normaliserede segmenter og
 * på segmenter hvor `-`, `_` og `.` er fjernet, så `audit-log`, `audit_log` og
 * `audit.log` alle rammer `auditlog`.
 */
export function isProtectedResource(target) {
  const norm = normalizeResource(target);
  if (!norm) return false;
  const parts = norm.split("/");
  for (const part of parts) {
    if (PROTECTED_ROOTS.has(part)) return true;
    if (PROTECTED_ROOTS.has(part.replace(/[-_.]/g, ""))) return true;
  }
  // `res://<tenant>/<type>/<lokal-id>` — typen er det sikkerhedsbærende segment.
  if (/^res:/.test(norm)) {
    const type = parts[2] ?? "";
    if (PROTECTED_ROOTS.has(type) || PROTECTED_ROOTS.has(type.replace(/[-_.]/g, ""))) return true;
  }
  return false;
}

/** A4: et muterende verbum mod en beskyttet ressource. Absolut forbud. */
export function isA4Violation(verb, target) {
  return isMutatingVerb(verb) && isProtectedResource(target);
}

/**
 * Ensrettet scope-matchning: et capability-scope dækker sig selv og sine børn,
 * aldrig sine forældre. `dummy-ok/child` giver derfor ikke adgang til
 * `dummy-ok`. Glob-mønstre er forankret i starten af stien.
 */
export function withinScope(target, capabilityScope) {
  const t = normalizeResource(target);
  const s = normalizeResource(capabilityScope);
  if (!s) return false;
  if (t === s) return true;
  if (!/[?*]/.test(s)) return t.startsWith(s + "/");
  const rx = new RegExp(
    "^" + s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "(/|$)"
  );
  return rx.test(t);
}

/** Er capabilityens scope inden for de ejede komponenter? (ensrettet) */
export function capabilityWithinOwned(capabilityTarget, ownedComponents = []) {
  return ownedComponents.some((owned) => withinScope(capabilityTarget, owned));
}
