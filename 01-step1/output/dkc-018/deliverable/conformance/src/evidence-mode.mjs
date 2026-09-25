/**
 * DKC-018 — adskillelse af kontraktchecks, integration og driftsbevis.
 *
 * Et fixture-pass er ikke bevis på håndhævelse i en rigtig deployment. Denne
 * modul gør adskillelsen maskinelt håndhævet:
 *
 *   - hver evidenspost bærer `mode` (fixture/contract/integration/runtime),
 *     commit, image-digest, miljø, upstream-version, run-ID, indsamlingstid og
 *     udløb,
 *   - `digest` er en SHA-256 over postens kanoniske indhold (uden `digest` og
 *     `signature`). En manuel redigering af `result: pass` bryder digesten og
 *     afvises,
 *   - en produktionsbadge kræver mindst ét integration/runtime-bevis pr.
 *     påkrævet emne, bundet til det præcise commit/image/miljø og uudløbet.
 *     Et sæt der kun indeholder fixture/contract kan højst få `fixture-only`,
 *   - udløbet, fremtidsdateret, forkert commit/image/miljø eller uverificerbart
 *     bevis afvises med en stabil årsag.
 *
 * Validatorerne er rene funktioner, så de kan bruges af conformance, probe-
 * køreren, release-gaten og CI uden netværk.
 */
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";

/** Modenhedsniveauerne. `fixture` og `contract` er hurtige og offline. */
export const MODES = {
  fixture: { label: "Fixture", productionEligible: false, description: "Sample-/negativdata — ikke en kørende integration" },
  contract: { label: "Contract", productionEligible: false, description: "Skema-/metavalidering — beviser form, ikke drift" },
  integration: { label: "Integration", productionEligible: true, description: "Kørt mod et levende system på det angivne commit" },
  runtime: { label: "Runtime", productionEligible: true, description: "Målt i en kørende deployment i det angivne miljø" },
};

export const MODE_NAMES = Object.keys(MODES);
export const PRODUCTION_MODES = MODE_NAMES.filter((m) => MODES[m].productionEligible);
export const NON_PRODUCTION_MODES = MODE_NAMES.filter((m) => !MODES[m].productionEligible);
export const ENVIRONMENTS = ["local", "dev", "staging", "prod"];

/** Kanonisering identisk med PDP'ens og runtimens digest (sorterede nøgler). */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

/**
 * SHA-256 over postens kanoniske indhold uden `digest` og `signature`.
 * Signaturen dækker digesten, så den kan ikke selv indgå i digesten.
 */
export function recordDigest(record) {
  const { digest: _digest, signature: _signature, ...content } = record ?? {};
  return createHash("sha256").update(canonicalize(content)).digest("hex");
}

/** Sæt `digest` på en post og returnér en kopi. */
export function sealRecord(record) {
  const sealed = { ...record };
  delete sealed.signature;
  sealed.digest = recordDigest(sealed);
  return sealed;
}

/** Signér en forseglet post med Ed25519 (kanonisk payload = digesten). */
export function signRecord(privateKeyPem, record) {
  const sealed = sealRecord(record);
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const value = cryptoSign(null, Buffer.from(sealed.digest, "utf8"), privateKey).toString("base64");
  return { ...sealed, signature: { algorithm: "ed25519", keyId: keyIdOf(publicKeyPem), value } };
}

export function keyIdOf(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/**
 * Verificér en posts signatur mod et trust anchor (`Map` eller objekt keyId →
 * offentlig PEM). Uden en signatur er resultatet `unsigned`.
 */
export function verifyRecordSignature(record, trustKeys = {}) {
  if (!record?.signature) return { ok: false, reason: "posten er ikke signeret" };
  const publicKeyPem = trustKeys?.get?.(record.signature.keyId) ?? trustKeys?.[record.signature.keyId];
  if (!publicKeyPem) return { ok: false, reason: `nøglen '${record.signature.keyId}' er ikke betroet` };
  if (record.signature.keyId !== keyIdOf(publicKeyPem)) {
    return { ok: false, reason: "signaturens nøgle-id matcher ikke den betroede nøgle" };
  }
  try {
    const ok = cryptoVerify(null, Buffer.from(record.digest, "utf8"), createPublicKey(publicKeyPem), Buffer.from(record.signature.value, "base64"));
    return { ok, reason: ok ? null : "signaturen matcher ikke digesten" };
  } catch (err) {
    return { ok: false, reason: `signaturverifikation fejlede: ${err.message}` };
  }
}

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;

function err(path, message) {
  return { path, message };
}

/**
 * Semantiske problemer for én evidenspost. Skemaet håndhæver formen; her
 * afgøres om posten faktisk må bruges som bevis.
 *
 * @param {object} record
 * @param {object} [opts]
 * @param {number|Date|string} [opts.now]              Tidspunkt for friskhed.
 * @param {object} [opts.expected]                     `{ commit, imageDigest, environment, modes, subject, upstreamVersion }`.
 * @param {object} [opts.trustKeys]                    keyId → PEM (kræver signatur hvis sat).
 * @param {boolean} [opts.requireSignature]            Kræv en verificeret signatur.
 */
export function evidenceRecordProblems(record, { now = Date.now(), expected = {}, trustKeys = null, requireSignature = false } = {}) {
  const problems = [];
  if (!record || typeof record !== "object") return [err("/", "evidensposten er ikke et objekt")];
  const at = (p) => `/${p}`;

  const nowMs = now instanceof Date ? now.getTime() : typeof now === "string" ? Date.parse(now) : Number(now);
  const captured = Date.parse(record.capturedAt);
  const expires = Date.parse(record.expiresAt);
  if (Number.isFinite(captured) && captured > nowMs) problems.push(err(at("capturedAt"), "evidensen er dateret i fremtiden og kan ikke bruges"));
  if (!Number.isFinite(expires)) problems.push(err(at("expiresAt"), "evidensen mangler et gyldigt udløb"));
  else if (expires <= nowMs) problems.push(err(at("expiresAt"), `evidensen udløb ${record.expiresAt}`));

  if (!SHA40.test(record.commit ?? "")) problems.push(err(at("commit"), "evidensen mangler en fuld commit-binding"));
  if (record.imageDigest !== null && record.imageDigest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(record.imageDigest)) {
    problems.push(err(at("imageDigest"), "image-digest er ikke på formen sha256:<64 hex>"));
  }
  if (expected.commit && record.commit !== expected.commit) {
    problems.push(err(at("commit"), `evidensen er bundet til commit ${record.commit}, ikke ${expected.commit}`));
  }
  if (expected.imageDigest !== undefined && expected.imageDigest !== null && record.imageDigest !== expected.imageDigest) {
    problems.push(err(at("imageDigest"), `evidensen er bundet til image ${record.imageDigest ?? "null"}, ikke ${expected.imageDigest}`));
  }
  if (expected.environment && record.environment !== expected.environment) {
    problems.push(err(at("environment"), `evidensen er indsamlet i '${record.environment}', ikke '${expected.environment}'`));
  }
  if (expected.upstreamVersion && record.upstreamVersion !== expected.upstreamVersion) {
    problems.push(err(at("upstreamVersion"), `evidensen gælder upstream '${record.upstreamVersion}', ikke '${expected.upstreamVersion}'`));
  }
  const modes = expected.modes ?? null;
  if (modes && !modes.includes(record.mode)) {
    problems.push(err(at("mode"), `evidensmoden '${record.mode}' er ikke tilladt her (kræver ${modes.join("/")})`));
  }
  if (expected.subject) {
    const subject = typeof expected.subject === "string" ? { name: expected.subject } : expected.subject;
    if (subject.name && record.subject?.name !== subject.name) {
      problems.push(err(at("subject/name"), `evidensen gælder '${record.subject?.name}', ikke '${subject.name}'`));
    }
    if (subject.verb && record.subject?.verb !== subject.verb) {
      problems.push(err(at("subject/verb"), `evidensen gælder verbet '${record.subject?.verb ?? "—"}', ikke '${subject.verb}'`));
    }
  }

  // Manipulationsdetektion: digesten skal matche postens faktiske indhold.
  if (!SHA64.test(record.digest ?? "")) {
    problems.push(err(at("digest"), "evidensen mangler en SHA-256 over sit indhold"));
  } else if (recordDigest(record) !== record.digest) {
    problems.push(err(at("digest"), "evidensens digest matcher ikke indholdet — posten er ændret manuelt efter forsegling"));
  }

  if (requireSignature || trustKeys) {
    const verified = verifyRecordSignature(record, trustKeys ?? {});
    if (!verified.ok) problems.push(err(at("signature"), `evidensens signatur er ikke verificeret: ${verified.reason}`));
  }
  return problems;
}

/** `{ ok, errors }`-form, så den kan bruges som de øvrige validatorer. */
export function validateEvidenceRecord(record, ajv, opts) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.evidenceRecord, record);
  const result = errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...evidenceRecordProblems(record, opts));
  return { ok: result.length === 0, errors: result };
}

/**
 * Bedøm én post mod et kravs forventninger. Returnerer en stabil `status`, så
 * en badge/gate kan skelne fixture fra driftsbevis uden at læse prosa.
 */
export function assessRecord(record, { now = Date.now(), expected = {}, trustKeys = null, requireSignature = false } = {}) {
  const problems = evidenceRecordProblems(record, { now, expected, trustKeys, requireSignature });
  if (record?.result !== "pass") {
    return { status: "not-pass", eligible: false, reasons: [`resultatet er '${record?.result ?? "?"}', ikke 'pass'`], problems };
  }
  const digestProblem = problems.find((p) => p.path === "/digest");
  if (digestProblem) return { status: "tampered", eligible: false, reasons: [digestProblem.message], problems };
  const expired = problems.find((p) => p.path === "/expiresAt" && /udløb/.test(p.message));
  if (expired) return { status: "expired", eligible: false, reasons: [expired.message], problems };
  const binding = problems.find((p) => ["/commit", "/imageDigest", "/environment", "/upstreamVersion"].includes(p.path));
  if (binding) return { status: "wrong-artifact", eligible: false, reasons: [binding.message], problems };
  const modeProblem = problems.find((p) => p.path === "/mode");
  if (modeProblem) {
    const badge = record?.mode === "fixture" || record?.mode === "contract" ? "fixture-only" : "unsupported-mode";
    return { status: badge, eligible: false, reasons: [modeProblem.message], problems };
  }
  if (problems.length) return { status: "rejected", eligible: false, reasons: problems.map((p) => p.message), problems };
  return { status: "eligible", eligible: true, reasons: [], problems: [] };
}

/**
 * Produktionsbadge for et sæt krav. Hvert krav skal dækkes af mindst ét
 * integration/runtime-bevis. Et sæt der kun har fixture/contract kan højst nå
 * `fixture-only` og får aldrig `productionReady: true`.
 *
 * @param {object} opts
 * @param {Array}  opts.requirements  `[{ id, subject?, modes? }]`
 * @param {Array}  opts.records
 * @param {object} [opts.expected]    Fælles binding `{ commit, imageDigest, environment, upstreamVersion, modes }`.
 */
export function productionBadge({ requirements = [], records = [], now = Date.now(), expected = {}, trustKeys = null, requireSignature = false } = {}) {
  const productionModes = expected.modes ?? PRODUCTION_MODES;
  const coverage = [];
  const allReasons = [];
  for (const req of requirements) {
    const candidates = records.filter((r) => {
      if (req.subject && typeof req.subject === "object") {
        if (req.subject.name && r.subject?.name !== req.subject.name) return false;
        if (req.subject.verb && r.subject?.verb !== req.subject.verb) return false;
      } else if (typeof req.subject === "string" && r.subject?.name !== req.subject) {
        return false;
      }
      return true;
    });
    const assessed = candidates.map((r) => ({ record: r, ...assessRecord(r, { now, expected: { ...expected, modes: req.modes ?? productionModes }, trustKeys, requireSignature }) }));
    const eligible = assessed.filter((a) => a.eligible);
    const nonProduction = assessed.filter((a) => a.record.result === "pass" && NON_PRODUCTION_MODES.includes(a.record.mode));
    let status = "covered";
    let reasons = [];
    if (eligible.length === 0) {
      if (nonProduction.length > 0) {
        status = "fixture-only";
        reasons = [`'${req.id}' har kun ${nonProduction.map((a) => a.record.mode).join("/")}-bevis — det beviser ikke håndhævelse i drift`];
      } else if (assessed.length > 0) {
        status = assessed.map((a) => a.status).find((s) => s !== "eligible") ?? "rejected";
        reasons = assessed.flatMap((a) => a.reasons);
      } else {
        status = "missing";
        reasons = [`'${req.id}' har ingen evidens`];
      }
    }
    coverage.push({ id: req.id, status, eligible: eligible.map((a) => a.record.id), fixtureOnly: nonProduction.map((a) => a.record.id), reasons });
    allReasons.push(...reasons);
  }
  const fixtureOnly = coverage.some((c) => c.status === "fixture-only");
  const productionReady = requirements.length > 0 && coverage.every((c) => c.status === "covered");
  let badge = "none";
  if (productionReady) badge = "production";
  else if (fixtureOnly) badge = "fixture-only";
  else if (coverage.some((c) => c.status === "missing")) badge = "missing";
  else if (coverage.some((c) => ["expired", "wrong-artifact", "tampered"].includes(c.status))) badge = "rejected";
  return { productionReady, badge, coverage, reasons: [...new Set(allReasons)] };
}

/**
 * Autorisér en release ud fra et sæt evidensposter. Adskiller de poster der
 * faktisk kan bære release fra dem der afvises, og kræver at ALLE påkrævede
 * emner er dækket af et integration/runtime-bevis.
 */
export function verifyReleaseEvidence({ requirements = [], records = [], now = Date.now(), expected = {}, trustKeys = null, requireSignature = true } = {}) {
  const badge = productionBadge({ requirements, records, now, expected, trustKeys, requireSignature });
  const rejected = [];
  for (const record of records) {
    const assessment = assessRecord(record, { now, expected, trustKeys, requireSignature });
    if (!assessment.eligible) rejected.push({ id: record.id, status: assessment.status, reasons: assessment.reasons });
  }
  return { accepted: badge.productionReady, badge: badge.badge, coverage: badge.coverage, rejected, reasons: badge.reasons };
}

// ---------------------------------------------------------------------------
// Indlæsning af evidensposter fra en mappe (bruges af CLI og tests)
// ---------------------------------------------------------------------------

/** Læs alle `*.evidence.json`-poster i en mappe. */
export function loadEvidenceRecords(dir) {
  if (!dir || !existsSync(dir)) return [];
  const records = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".evidence.json")).sort()) {
    try {
      records.push({ file, record: JSON.parse(readFileSync(join(dir, file), "utf8")) });
    } catch (err) {
      records.push({ file, error: `ugyldig JSON: ${err.message}` });
    }
  }
  return records;
}
