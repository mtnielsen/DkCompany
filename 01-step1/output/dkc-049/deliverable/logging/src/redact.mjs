/**
 * DKC-049 — minimering, secret-redaktion og fjernelse af skjult modelræsonnering.
 *
 * Loggen er revisionsspor, ikke et hemmelighedslager og ikke modellens
 * private notesbog. Alt der skrives passerer derfor denne funktion, som:
 *
 *   1. fjerner hemmeligheder (nøgler, tokens, adgangskoder) på feltnavn og
 *      værdimønster — også indlejret (via DKC-009's `redactSecrets`),
 *   2. fjerner skjulte ræsonneringsfelter (chain-of-thought, intern tankestrøm),
 *      som aldrig må ende i revisionssporet,
 *   3. minimerer unødige persondata i de frie datablokke og bevarer en digest,
 *      så en sag kan korreleres uden at de rå værdier opbevares.
 *
 * Resultatet er `{ record, redactions, reasoningRemoved, personalDataDigest,
 * personalFields }`.
 */
import { redactSecrets, isPersonalKey, isSecretKey, isSecretValue, REDACTED } from "../../persistence/src/redact.mjs";
import { digest } from "./canonical.mjs";

export const MINIMIZED = "[MINIMIZED]";
export { REDACTED };

export const DEFAULT_FORBIDDEN_REASONING_KEYS = [
  "chainOfThought",
  "chain_of_thought",
  "cot",
  "reasoning",
  "reasoningTrace",
  "internalThoughts",
  "internal_thoughts",
  "thoughts",
  "scratchpad",
  "hiddenReasoning",
];

/** Fri-tekst-/datablokke hvor persondata må optræde og derfor minimeres. */
const PERSONAL_SCOPE_RES = [
  /(^|\/)observation\/value$/,
  /(^|\/)action\/tool\/parameters$/,
  /(^|\/)action\/before$/,
  /(^|\/)action\/after$/,
];

function inPersonalScope(path) {
  return PERSONAL_SCOPE_RES.some((re) => re.test(path));
}

/** Pseudonyme, strukturelle identiteter bevares (de er ikke rå persondata). */
function isPseudonymous(value) {
  if (typeof value !== "string") return false;
  return /^(oidc\||spiffe:\/\/|res:\/\/|urn:|[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._:-]*)$/i.test(value);
}

/**
 * Fjern skjult ræsonnering og minimer persondata i de frie datablokke.
 * Hemmeligheder fjernes først af `redactSecrets`.
 */
export function redactLogRecord(record, { forbiddenKeys = DEFAULT_FORBIDDEN_REASONING_KEYS } = {}) {
  const redactions = [];
  const withoutSecrets = redactSecrets(record, { redactions });
  const forbidden = new Set((forbiddenKeys ?? []).map((k) => String(k).toLowerCase()));
  const reasoningRemoved = [];
  const personalFields = {};
  const personalValues = {};

  function walk(node, path, personal) {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item, i) => walk(item, `${path}/${i}`, personal));
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const child = `${path}/${key}`;
      if (forbidden.has(key.toLowerCase())) {
        reasoningRemoved.push(child);
        continue;
      }
      const nowPersonal = personal || inPersonalScope(child);
      if (nowPersonal && isPersonalKey(key) && !isPseudonymous(value)) {
        personalFields[child] = true;
        personalValues[child] = value;
        out[key] = MINIMIZED;
        continue;
      }
      out[key] = walk(value, child, nowPersonal);
    }
    return out;
  }

  const cleaned = walk(withoutSecrets, "", false);
  return {
    record: cleaned,
    redactions: [...new Set(redactions)].sort(),
    reasoningRemoved: [...new Set(reasoningRemoved)].sort(),
    personalFields: Object.keys(personalFields).sort(),
    personalDataDigest: Object.keys(personalValues).length ? digest(personalValues) : null,
  };
}

/** Kaster hvis et vilkårligt payload stadig bærer en hemmelighed. Fail-closed. */
export function assertNoSecrets(value, path = "/") {
  const found = [];
  function walk(node, current) {
    if (node === null || typeof node !== "object") {
      if (isSecretValue(node)) found.push(current);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${current}${i}/`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (isSecretKey(key) && child !== REDACTED) found.push(`${current}${key}`);
      walk(child, `${current}${key}/`);
    }
  }
  walk(value, path);
  if (found.length) throw new Error(`logposten bærer en hemmelighed ved ${found[0]}`);
  return true;
}

/** Kaster hvis et payload bærer et skjult ræsonneringsfelt. Fail-closed. */
export function assertNoHiddenReasoning(value, forbiddenKeys = DEFAULT_FORBIDDEN_REASONING_KEYS, path = "/") {
  const forbidden = new Set((forbiddenKeys ?? []).map((k) => String(k).toLowerCase()));
  function walk(node, current) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${current}${i}/`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (forbidden.has(key.toLowerCase())) throw new Error(`logposten bærer skjult modelræsonnering ved ${current}${key}`);
      walk(child, `${current}${key}/`);
    }
  }
  walk(value, path);
  return true;
}
