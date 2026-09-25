/**
 * DKC-019 — semantiske validatorer for dataregisteret.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et
 * skema ikke kan udtrykke alene:
 *
 *   - hver post og subprocessor har et navngivet menneske som ejer,
 *   - behandlingsgrundlaget er et ejerbesluttet felt; koden udleder det aldrig,
 *   - en persondatapost uden ejerbeslutning, databehandleraftale eller
 *     tredjelandsvurdering er en blocker og må ikke stå som 'approved',
 *   - slettefristen er formålsbestemt (peger på et formål i posten) og versioneret,
 *   - persondataposter dækker prompts, embeddings, supportadgang, logs, backups
 *     og modelproviderens databrug,
 *   - EU-hosting er ikke i sig selv fravær af tredjelandsoverførsel: vurderingen
 *     skal være eksplicit og udført af et navngivet menneske.
 *
 * Validatorerne er rene funktioner og bruges af conformance, compliance og
 * registertjenesten.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

function err(path, message) {
  return { path, message };
}

export const PERSONAL_DATA_CATEGORIES = new Set(["personal", "special-category"]);

/** De artefakter en persondatapost skal gøre rede for. */
export const REQUIRED_PERSONAL_ASSET_KINDS = [
  "prompts",
  "embeddings",
  "support-access",
  "logs",
  "backups",
  "model-provider-usage",
];

const assetKindsOf = (entry) => new Set((entry?.assets ?? []).map((a) => a.kind));

/** Er posten persondatabærende? */
export function isPersonalEntry(entry) {
  return (entry?.dataCategories ?? []).some((c) => PERSONAL_DATA_CATEGORIES.has(c));
}

/**
 * Blockerende forhold for en persondatapost. Returnerer en liste af
 * menneskelæsbare grunde. En tom liste betyder, at posten må stå som 'approved'.
 */
export function entryBlockers(entry) {
  const blockers = [];
  if (!isPersonalEntry(entry)) return blockers;

  const legal = entry?.legalBasis ?? {};
  if (legal.status !== "owner-decided") blockers.push("behandlingsgrundlaget er ikke ejerbesluttet");
  else if (!legal.ground) blockers.push("behandlingsgrundlaget mangler en konkret grund");
  if (!isNamedHuman(legal.decidedBy)) blockers.push("behandlingsgrundlaget mangler et navngivet menneske som beslutningstager");
  if (!(legal.decidedAt ?? "").trim()) blockers.push("behandlingsgrundlaget mangler et beslutningstidspunkt");

  if (!entry?.roles?.controller?.contractRef) blockers.push("databehandler-/dataansvarligrollen mangler en controller-aftale");
  if (!entry?.roles?.processor?.contractRef) blockers.push("databehandler-/dataansvarligrollen mangler en processor-aftale");

  const transfer = entry?.location?.thirdCountryTransfer ?? {};
  if (transfer.assessed !== true) blockers.push("tredjelandsoverførslen er ikke vurderet");
  else if (!isNamedHuman(transfer.assessedBy)) blockers.push("tredjelandsvurderingen mangler et navngivet menneske");
  else if (!(transfer.assessedAt ?? "").trim()) blockers.push("tredjelandsvurderingen mangler et tidspunkt");
  else if (transfer.status === "undetermined") blockers.push("tredjelandsoverførslen er stadig uafklaret");

  const missingAssets = [...REQUIRED_PERSONAL_ASSET_KINDS].filter((k) => !assetKindsOf(entry).has(k));
  if (missingAssets.length) blockers.push(`persondataposten mangler databærende artefakter: ${missingAssets.join(", ")}`);

  return blockers;
}

function transferProblems(path, transfer, hostingRegion) {
  const problems = [];
  if (!transfer) {
    problems.push(err(path, "tredjelandsvurdering mangler (EU-hosting er ikke i sig selv fravær af overførsel)"));
    return problems;
  }
  if (transfer.assessed !== true) {
    problems.push(err(`${path}/assessed`, "overførslen skal være eksplicit vurderet, også når data hostes i EU/EEA"));
  } else {
    if (!isNamedHuman(transfer.assessedBy)) problems.push(err(`${path}/assessedBy`, "vurderingen skal være udført af et navngivet menneske"));
    if (!(transfer.assessedAt ?? "").trim()) problems.push(err(`${path}/assessedAt`, "vurderingen mangler et tidspunkt"));
    if (transfer.status === "undetermined") problems.push(err(`${path}/status`, "en gennemført vurdering kan ikke være 'undetermined'"));
  }
  if (transfer.status === "present" && !(transfer.mechanisms ?? []).some((m) => m && m !== "none")) {
    problems.push(err(`${path}/mechanisms`, "en konstateret overførsel kræver et overførselsgrundlag (scc, bcr, adequacy-decision eller derogation)"));
  }
  if (transfer.status === "none") {
    if (!(transfer.note ?? "").trim()) {
      problems.push(err(`${path}/note`, "når der ikke konstateres overførsel, skal grunden fremgå eksplicit — også for EU-hosting"));
    }
    if (hostingRegion === "unknown") {
      problems.push(err(path, "ukendt hostingregion kan ikke samtidig være 'ingen overførsel'"));
    }
  }
  return problems;
}

export function dataRegisterProblems(data) {
  const problems = [];

  const subprocessorIds = new Set();
  for (const [i, sp] of (data?.subprocessors ?? []).entries()) {
    const path = `/subprocessors/${i}`;
    if (subprocessorIds.has(sp.id)) problems.push(err(`${path}/id`, `dubleret subprocessor-id '${sp.id}'`));
    subprocessorIds.add(sp.id);
    if (!isNamedHuman(sp.approvedBy)) problems.push(err(`${path}/approvedBy`, "subprocessoren skal være godkendt af et navngivet menneske"));
    problems.push(...transferProblems(`${path}/thirdCountryTransfer`, sp.thirdCountryTransfer, sp.hostingRegion));
  }

  const entryIds = new Set();
  const seenAssetKinds = new Set();
  for (const [i, entry] of (data?.entries ?? []).entries()) {
    const path = `/entries/${i}`;
    if (entryIds.has(entry.id)) problems.push(err(`${path}/id`, `dubleret registerpost-id '${entry.id}'`));
    entryIds.add(entry.id);

    if (!isNamedHuman(entry.owner)) problems.push(err(`${path}/owner`, "registerposten skal have et navngivet menneske som ejer"));

    const purposeIds = new Set();
    for (const [j, purpose] of (entry.purposes ?? []).entries()) {
      if (purposeIds.has(purpose.id)) problems.push(err(`${path}/purposes/${j}/id`, `dubleret formål '${purpose.id}'`));
      purposeIds.add(purpose.id);
    }

    const personal = isPersonalEntry(entry);
    if (entry.retention) {
      if (!purposeIds.has(entry.retention.purposeRef)) {
        problems.push(err(`${path}/retention/purposeRef`, `slettefristen peger på formålet '${entry.retention.purposeRef}', som ikke findes i posten`));
      }
      if (!(entry.retention.version ?? "").trim()) problems.push(err(`${path}/retention/version`, "slettefristen skal være versioneret"));
      if (!isNamedHuman(entry.retention.approvedBy)) problems.push(err(`${path}/retention/approvedBy`, "slettefristen skal være godkendt af et navngivet menneske"));
      if (!(entry.retention.approvedAt ?? "").trim()) problems.push(err(`${path}/retention/approvedAt`, "slettefristen mangler et godkendelsestidspunkt"));
    }

    problems.push(...transferProblems(`${path}/location/thirdCountryTransfer`, entry.location?.thirdCountryTransfer, entry.location?.hostingRegion));

    if (personal) {
      const legal = entry.legalBasis ?? {};
      if (legal.status === "owner-decided") {
        if (!legal.ground) problems.push(err(`${path}/legalBasis/ground`, "et ejerbesluttet grundlag skal angive en konkret grund"));
        if (!isNamedHuman(legal.decidedBy)) problems.push(err(`${path}/legalBasis/decidedBy`, "et ejerbesluttet grundlag skal have et navngivet menneske som beslutningstager"));
        if (!(legal.decidedAt ?? "").trim()) problems.push(err(`${path}/legalBasis/decidedAt`, "et ejerbesluttet grundlag mangler et beslutningstidspunkt"));
      } else {
        if (legal.ground) problems.push(err(`${path}/legalBasis/ground`, "en uafklaret beslutning må ikke angive en grund — grundlaget må ikke opfindes"));
      }
      if (!entry.roles?.controller?.contractRef) problems.push(err(`${path}/roles/controller`, "persondatapost kræver en dataansvarlig-rolle med kontraktreference"));
      if (!entry.roles?.processor?.contractRef) problems.push(err(`${path}/roles/processor`, "persondatapost kræver en databehandler-rolle med kontraktreference"));
      const missingAssets = [...REQUIRED_PERSONAL_ASSET_KINDS].filter((k) => !assetKindsOf(entry).has(k));
      for (const kind of missingAssets) problems.push(err(`${path}/assets`, `persondataposten mangler artefakttypen '${kind}'`));
    }

    for (const ref of entry.subprocessorRefs ?? []) {
      if (!subprocessorIds.has(ref)) problems.push(err(`${path}/subprocessorRefs`, `ukendt subprocessor '${ref}'`));
    }
    for (const [j, recipient] of (entry.recipients ?? []).entries()) {
      if (["processor", "subprocessor", "third-party"].includes(recipient.role) && !(recipient.contractRef ?? "").trim()) {
        problems.push(err(`${path}/recipients/${j}/contractRef`, `modtageren '${recipient.name}' med rollen '${recipient.role}' kræver en kontraktreference`));
      }
    }

    // Blocker-konsistens: en post med en uafklaret blocker må ikke stå som godkendt.
    const blockers = entryBlockers(entry);
    if (blockers.length && entry.status === "approved") {
      problems.push(err(`${path}/status`, `posten kan ikke være 'approved' mens den har blockere: ${blockers.join("; ")}`));
    }

    for (const kind of assetKindsOf(entry)) seenAssetKinds.add(kind);
  }

  for (const kind of REQUIRED_PERSONAL_ASSET_KINDS) {
    if (!seenAssetKinds.has(kind)) problems.push(err("/entries", `registeret dækker ikke artefakttypen '${kind}' — prompts, embeddings, supportadgang, logs, backups og modelproviderens databrug skal med`));
  }

  return problems;
}

export function validateDataRegister(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.dataRegister, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...dataRegisterProblems(data));
  return { ok: result.length === 0, errors: result };
}

/** Validér data-register-eksempler i en mappe (filnavn starter med 'data-register'). */
export function validateDataRegisterDir(dir, { pattern = /^data-register/ } = {}) {
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
    const { ok, errors } = validateDataRegister(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}
