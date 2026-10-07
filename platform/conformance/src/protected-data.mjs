/**
 * DKC-047 — semantiske validatorer for beskyttede dataklasser (AI-immutable).
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke alene:
 *
 *   - hver post har et navngivet menneske som ejer og som omklassificeringsmyndighed,
 *   - en ikke-almindelig klasse skal dække alle otte forbud (direkte/indirekte
 *     ændring, alias/current-pointer, autoritativ pointer, policy, lifecycle,
 *     nøgler og sletning),
 *   - retention-locked (WORM) kræver en vurderet, formålsbestemt og endelig frist
 *     — også når dataene er persondata; uendelig WORM på persondata afvises,
 *   - no-AI-access er et selvstændigt adgangsflag, ikke en variant af dataClass,
 *   - fuld lager-/nøglehåndhævelse må kun påstås med bevis; ellers skal posten
 *     ærligt sige at beskyttelsen er adgangs-/transitionskontrol (DKC-048),
 *   - den menneskelige proces for ny version, lovlig sletning og
 *     retentionvurdering skal være navngivet.
 *
 * Validatorerne er rene funktioner og bruges af conformance, data-protection og
 * registertjenesten.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

function err(path, message) {
  return { path, message };
}

/** Dataklasser der er beskyttede (alt andet end almindelig). */
export const PROTECTED_DATA_CLASSES = ["ai-read-only", "append-only", "retention-locked"];

/** De forbud en beskyttet post skal dække eksplicit. */
export const REQUIRED_PROHIBITIONS = [
  "direct-change",
  "indirect-change",
  "alias-pointer",
  "authoritative-pointer",
  "policy",
  "lifecycle",
  "keys",
  "deletion",
];

const PERSONAL = new Set(["personal", "special-category"]);

export function isProtectedClass(dataClass) {
  return PROTECTED_DATA_CLASSES.includes(dataClass);
}

export function isPersonalRecord(record) {
  return (record?.dataCategories ?? []).some((c) => PERSONAL.has(c));
}

export function protectedDataProblems(data) {
  const problems = [];
  const ids = new Set();
  for (const [i, record] of (data?.records ?? []).entries()) {
    const path = `/records/${i}`;
    if (ids.has(record.id)) problems.push(err(`${path}/id`, `dubleret beskyttelsespost-id '${record.id}'`));
    ids.add(record.id);

    if (!isNamedHuman(record.owner)) problems.push(err(`${path}/owner`, "posten skal have et navngivet menneske som ejer"));
    if (!Array.isArray(record.reclassifiers) || record.reclassifiers.length === 0) {
      problems.push(err(`${path}/reclassifiers`, "posten skal navngive mindst ét menneske der må omklassificere"));
    } else {
      for (const [j, human] of record.reclassifiers.entries()) {
        if (!isNamedHuman(human)) problems.push(err(`${path}/reclassifiers/${j}`, "omklassificeringsmyndighed skal være et navngivet menneske — AI kan ikke omklassificere"));
      }
    }

    if (!(record.authoritativePointer ?? "").trim()) problems.push(err(`${path}/authoritativePointer`, "den autoritative pointer mangler"));
    if (!(record.keyDomain ?? "").trim()) problems.push(err(`${path}/keyDomain`, "nøgledomænet mangler"));

    if (isProtectedClass(record.dataClass)) {
      const missing = REQUIRED_PROHIBITIONS.filter((p) => !(record.prohibitions ?? []).includes(p));
      if (missing.length) problems.push(err(`${path}/prohibitions`, `klassen '${record.dataClass}' mangler forbud: ${missing.join(", ")}`));
    }

    for (const step of ["newVersion", "legalDeletion", "retentionAssessment"]) {
      const value = record.humanProcess?.[step];
      if (!value) problems.push(err(`${path}/humanProcess/${step}`, `den menneskelige proces '${step}' mangler`));
      else if (!isNamedHuman(value.responsible)) problems.push(err(`${path}/humanProcess/${step}/responsible`, `'${step}' skal have et navngivet menneske som ansvarlig`));
    }

    // WORM kræver altid en vurderet, endelig frist. Det gælder især persondata:
    // en ubestemt WORM-lås uden formål og frist er en ulovlig opbevaring.
    if (record.dataClass === "retention-locked") {
      const retention = record.retention;
      if (!retention) {
        problems.push(err(`${path}/retention`, "retention-locked kræver en retention med formål og endelig frist"));
      } else {
        if (!(retention.purpose ?? "").trim()) problems.push(err(`${path}/retention/purpose`, "WORM uden et vurderet formål er en ubestemt lås"));
        if (!Number.isInteger(retention.maxDays) || retention.maxDays < 1) problems.push(err(`${path}/retention/maxDays`, "WORM kræver en endelig frist (maxDays >= 1) — ingen ubestemt lås"));
        if (!isNamedHuman(retention.assessedBy)) problems.push(err(`${path}/retention/assessedBy`, "retentionvurderingen skal være udført af et navngivet menneske"));
        if (!(retention.assessedAt ?? "").trim()) problems.push(err(`${path}/retention/assessedAt`, "retentionvurderingen mangler et tidspunkt"));
      }
      if (isPersonalRecord(record) && !record.retention) {
        problems.push(err(`${path}/retention`, "persondata må ikke WORM-låses uden en vurderet frist og et formål"));
      }
    }

    const enforcement = record.storageEnforcement ?? {};
    if (enforcement.status === "full") {
      if (!(record.keyDomain ?? "").trim()) problems.push(err(`${path}/storageEnforcement`, "fuld håndhævelse kræver et nøgledomæne"));
      if (!(record.evidence ?? []).length) problems.push(err(`${path}/storageEnforcement`, "fuld håndhævelse kræver bevis — en påstand er ikke nok"));
    } else if (!(enforcement.deliveredBy ?? "").trim()) {
      problems.push(err(`${path}/storageEnforcement/deliveredBy`, "når lager-/nøglehåndhævelse ikke er fuld, skal det erklæres hvem der leverer den (DKC-048)"));
    }
    if (enforcement.status !== "full" && /^(ai-read-only|append-only|retention-locked)$/.test(record.dataClass) && (record.prohibitions ?? []).length < REQUIRED_PROHIBITIONS.length) {
      problems.push(err(`${path}/prohibitions`, "beskyttelsen er kun adgangs-/transitionskontrol og skal dække alle forbud, også uden fuld lagerhåndhævelse"));
    }

    if (!(record.consumerModules ?? []).length) problems.push(err(`${path}/consumerModules`, "posten skal angive hvilke moduler der behandler de beskyttede data"));
  }
  return problems;
}

export function validateProtectedData(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.protectedData, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...protectedDataProblems(data));
  return { ok: result.length === 0, errors: result };
}

/** Validér beskyttelsesregistre i en mappe (filnavn starter med 'protected-data'). */
export function validateProtectedDataDir(dir, { pattern = /^protected-data/ } = {}) {
  const ajv = buildAjv().ajv;
  const results = [];
  if (!dir) return results;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && pattern.test(f)).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validateProtectedData(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}
