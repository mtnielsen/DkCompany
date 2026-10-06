/**
 * DKC-021 — semantik for slette- og tilbageholdelsespolitikken.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger et skema
 * ikke kan udtrykke alene:
 *
 *   - de fem obligatoriske datalag (primærlager, indeks, cache, afledte AI-data
 *     og backups) skal være dokumenteret, ellers er sletningen ikke dækket,
 *   - en flade der ikke kan slette fysisk skal stå som 'partial'/'unsupported'
 *     med en præcis begrundelse og en navngivet ejer,
 *   - tilbagehold skal kræve en begrundelse og en separat godkender, og AI må
 *     aldrig kunne slette eller lægge hold,
 *   - alle ufravigelige regler skal være slået til (default-deny, receipt før
 *     mutation, digest-kun revisionsspor og genanvendelse ved restore).
 *
 * Validatorerne er rene funktioner og bruges af conformance, CLI og tests.
 */
export const REQUIRED_SURFACE_KINDS = ["primary", "index", "cache", "derived-ai", "backup"];

const REQUIRED_RULES = [
  "defaultDeny",
  "holdRequiresJustification",
  "holdRequiresSeparateApprover",
  "holdBlocksDeletion",
  "restoreRequiresDeletionDecisions",
  "auditReceiptBeforeMutation",
  "receiptStoresSubjectDigestOnly",
];

function err(path, message) {
  return { path, message };
}

function isNamedHuman(value) {
  return Boolean(value && typeof value.subject === "string" && value.subject.trim() && typeof value.name === "string" && value.name.trim().length >= 2 && typeof value.role === "string" && value.role.trim());
}

/** Semantiske problemer for en RetentionDeletionPolicy. Tom liste = gyldig. */
export function deletionPolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "politikken mangler")];

  const kinds = new Map();
  const ids = new Set();
  for (const [i, surface] of (policy.surfaces ?? []).entries()) {
    const path = `/surfaces/${i}`;
    if (ids.has(surface.id)) problems.push(err(`${path}/id`, `dubleret flade-id '${surface.id}'`));
    ids.add(surface.id);
    kinds.set(surface.kind, (kinds.get(surface.kind) ?? 0) + 1);
    if (!isNamedHuman(surface.owner)) problems.push(err(`${path}/owner`, "fladen skal have et navngivet menneske som ejer"));
    if ((surface.coverage === "partial" || surface.coverage === "unsupported") && !(surface.reason ?? "").trim()) {
      problems.push(err(`${path}/reason`, `en '${surface.coverage}'-flade skal have en præcis begrundelse`));
    }
    if (surface.coverage === "unsupported" && !surface.external) {
      problems.push(err(`${path}/external`, "en 'unsupported'-flade skal være markeret som ekstern"));
    }
    if (surface.kind === "backup" && surface.legalHoldSupported === true) {
      // Backupkopier er WORM; et hold kan ikke håndhæves fysisk i backupen, kun
      // genanvendes ved restore. En påstand om det modsatte er uærlig.
      problems.push(err(`${path}/legalHoldSupported`, "backupfladen kan ikke håndhæve et hold fysisk; angiv false og brug suppressionsjournalen"));
    }
  }

  for (const kind of REQUIRED_SURFACE_KINDS) {
    if (!kinds.has(kind)) problems.push(err("/surfaces", `slettepolitikken dækker ikke datalaget '${kind}'`));
  }
  for (const [kind, count] of kinds) {
    if (kind !== "upstream" && count > 1) problems.push(err("/surfaces", `flere flader med samme kind '${kind}'`));
  }

  const principals = policy.principals ?? {};
  if (!(principals.deletionRoles ?? []).length) problems.push(err("/principals/deletionRoles", "der skal være mindst én sletterolle"));
  if (!(principals.holdApproverRoles ?? []).length) problems.push(err("/principals/holdApproverRoles", "der skal være mindst én hold-godkenderrolle"));
  if (principals.aiDenied !== true) problems.push(err("/principals/aiDenied", "AI må aldrig kunne slette eller lægge hold; aiDenied skal være true"));

  for (const rule of REQUIRED_RULES) {
    if (policy.rules?.[rule] !== true) problems.push(err(`/rules/${rule}`, `${rule} skal være slået til`));
  }

  if (!isNamedHuman(policy.approvedBy)) problems.push(err("/approvedBy", "politikken skal være godkendt af et navngivet menneske"));
  if (!(policy.approvedAt ?? "").trim()) problems.push(err("/approvedAt", "politikken mangler et godkendelsestidspunkt"));

  return problems;
}

/** Slå en flade op på dens id. */
export function surfaceById(policy, id) {
  return (policy?.surfaces ?? []).find((s) => s.id === id) ?? null;
}

/** Flader der dækker en given dataklasse. */
export function surfacesCovering(policy, dataClasses = []) {
  const wanted = new Set(dataClasses);
  return (policy?.surfaces ?? []).filter((s) => s.dataClasses.some((c) => wanted.has(c)));
}
