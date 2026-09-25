/**
 * DKC-009 — minimering, secret-redaktion og retention-klassifikation af
 * audit-payloads.
 *
 * Audit-loggen er bevis, men den må aldrig blive et hemmelighedslager. Alt der
 * skrives til den vedvarende log passerer derfor denne funktion, som:
 *
 *   1. fjerner hemmeligheder (nøgler, tokens, adgangskoder) både på feltnavn og
 *      på værdimønster — også når de ligger indlejret,
 *   2. udskiller personhenførbare felter fra det operationelle payload, så de
 *      kan opbevares med en anden (kortere) retention og slettes selvstændigt
 *      uden at brække hash-kæden,
 *   3. begrænser størrelser, så et payload ikke kan bruges til at sprænge loggen.
 *
 * Resultatet er `{ operational, personal, personalDigest, payloadDigest,
 * categories, retentionClass, redactions }`.
 */
import { createHash } from "node:crypto";

export const REDACTED = "[REDACTED]";

/** Feltnavne der altid er hemmeligheder, uanset værdi. */
const SECRET_KEY_RE = /(password|passwd|passphrase|secret|token|api[_-]?key|apikey|authorization|auth[_-]?header|cookie|private[_-]?key|client[_-]?secret|credential|session[_-]?id|bearer|signature|hmac)/i;

/** Værdimønstre der er hemmeligheder, uanset feltnavn. */
const SECRET_VALUE_RES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/i,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/, // AWS access key id
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub token
  /\bsk-[A-Za-z0-9]{16,}\b/, // API-nøgle
];

/** Feltnavne der (typisk) rummer personhenførbare data. */
const PERSONAL_KEY_RE = /^(email|e[-_]?mail|phone|mobile|telefon|name|fornavn|efternavn|fullname|full_name|address|adresse|ssn|cpr|personnummer|personal[_-]?number|subject|subject[_-]?id|user(name)?|kunde|employee|borger|fullName|first[_-]?name|last[_-]?name|date[_-]?of[_-]?birth|dob|ip[_-]?address|bank[_-]?account|iban)$/i;

/** De datakategorier der udløser personhenførbar behandling. */
const PERSONAL_CATEGORIES = new Set(["personal", "pseudonymised", "special-category"]);

const DEFAULT_LIMITS = { maxStringLength: 4096, maxArrayLength: 100, maxDepth: 12 };

function digestOf(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function isSecretValue(value) {
  if (typeof value !== "string") return false;
  return SECRET_VALUE_RES.some((re) => re.test(value));
}

function clampString(value, limit) {
  return value.length > limit ? `${value.slice(0, limit)}…[truncated]` : value;
}

/**
 * Redigér hemmeligheder og begræns størrelser rekursivt. Returnerer en ny
 * struktur; input muteres ikke.
 */
export function redactSecrets(value, { limits = DEFAULT_LIMITS, redactions = [] } = {}) {
  const seen = new WeakSet();
  function walk(node, depth, path) {
    if (node === null || typeof node !== "object") {
      if (typeof node === "string") {
        if (isSecretValue(node)) {
          redactions.push(path);
          return REDACTED;
        }
        return clampString(node, limits.maxStringLength);
      }
      return node;
    }
    if (depth > limits.maxDepth) return "[TRUNCATED]";
    if (seen.has(node)) return "[CYCLE]";
    seen.add(node);
    if (Array.isArray(node)) {
      const out = node.slice(0, limits.maxArrayLength).map((item, i) => walk(item, depth + 1, `${path}/${i}`));
      if (node.length > limits.maxArrayLength) out.push("[TRUNCATED]");
      return out;
    }
    const out = {};
    for (const [key, val] of Object.entries(node)) {
      const childPath = `${path}/${key}`;
      if (SECRET_KEY_RE.test(key)) {
        redactions.push(childPath);
        out[key] = REDACTED;
        continue;
      }
      out[key] = walk(val, depth + 1, childPath);
    }
    return out;
  }
  return walk(value, 0, "");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

/**
 * Split et payload i operationelle og personhenførbare felter.
 * Personfelter fjernes fra det operationelle payload; begge redigeres.
 */
function splitPersonal(payload) {
  const operational = {};
  const personal = {};
  if (!isPlainObject(payload)) return { operational: payload, personal: null };
  for (const [key, value] of Object.entries(payload)) {
    if (PERSONAL_KEY_RE.test(key)) personal[key] = value;
    else operational[key] = value;
  }
  return { operational, personal: Object.keys(personal).length ? personal : null };
}

/**
 * Forbered et payload til den vedvarende log. `dataCategories` er de kategorier
 * kalderen har deklareret; de bruges til at afgøre retention.
 */
export function prepareAuditPayload({ payload = {}, dataCategories = [], limits = DEFAULT_LIMITS, retentionClass = null } = {}) {
  const redactions = [];
  const safe = redactSecrets(payload ?? {}, { limits, redactions });
  const { operational, personal } = splitPersonal(safe);

  const declared = Array.isArray(dataCategories) ? dataCategories : [];
  const inferredPersonal = personal !== null;
  const personalWanted = inferredPersonal || declared.some((c) => PERSONAL_CATEGORIES.has(c));
  const personalObject = personalWanted ? personal ?? {} : null;

  const categories = new Set(declared);
  if (inferredPersonal) categories.add("personal");

  const personalDigest = personalObject !== null ? digestOf(personalObject) : null;
  const payloadDigest = digestOf(operational);

  return {
    operational,
    personal: personalObject,
    personalDigest,
    payloadDigest,
    categories: [...categories].sort(),
    retentionClass: retentionClass ?? (personalWanted ? "personal" : "operational"),
    redactions,
  };
}

export function isSecretKey(key) {
  return SECRET_KEY_RE.test(key);
}

export function isPersonalKey(key) {
  return PERSONAL_KEY_RE.test(key);
}

export { digestOf as payloadDigestOf };
