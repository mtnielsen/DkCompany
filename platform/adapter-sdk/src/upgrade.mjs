/**
 * DKC-024 — opgraderings- og rollbackplan pr. adapter.
 *
 * En upstream-opgradering er en gated, irreversibel ændring. Planen udledes
 * deterministisk af releaseprofilen og kandidaten, så den ikke kan påstå mere
 * end den godkendte version/edition tillader:
 *
 *   - målversionen skal ligge inden for en understøttet versionsserie og
 *     editionen skal være understøttet; ellers kræver opgraderingen en ny
 *     kandidat og releaseprofil,
 *   - backup og verificeret rollback er obligatoriske, og kandidaten skal
 *     erklære backup som understøttet,
 *   - hvert trin har en id, en ejerrolle og et kriterium, så en executor kan
 *     følge planen uden at opfinde egne trin.
 *
 * Planen udføres af det almindelige policy-/godkendelses-/executor-flow. Denne
 * modul planlægger og validerer; den udfører intet selv.
 */
import { parseVersion, satisfiesRange, compareVersions } from "./version.mjs";

const HUMAN = (subject, name, role) => ({ subject, name, role });

function step(id, title, role, description, criteria) {
  return { id, title, role, description, criteria };
}

/**
 * Byg en opgraderingsplan. `current` og `target` er `{ version, edition }`.
 * `releaseProfile` er profilen opgraderingen skal holde sig inden for.
 */
export function buildUpgradePlan({
  adapter,
  current,
  target,
  releaseProfile,
  candidate = null,
  operator = HUMAN("oidc|anna.andersen", "Anna Andersen", "Platform Owner"),
  maxDowntimeMinutes = 30,
} = {}) {
  if (!adapter) throw new Error("buildUpgradePlan kræver en adapter");
  if (!current?.version) throw new Error("buildUpgradePlan kræver current.version");
  if (!target?.version) throw new Error("buildUpgradePlan kræver target.version");
  if (!releaseProfile) throw new Error("buildUpgradePlan kræver en releaseprofil");

  const ranges = releaseProfile?.negotiation?.supportedRanges ?? [];
  const editions = releaseProfile?.negotiation?.supportedEditions ?? [];
  const blockers = [];

  const parsed = parseVersion(target.version);
  if (!parsed) blockers.push(`målversionen '${target.version}' er ikke en eksakt version`);
  const matchedRange = parsed ? ranges.find((range) => satisfiesRange(parsed, range)) ?? null : null;
  if (!matchedRange) {
    blockers.push(`målversionen '${target.version}' matcher ingen understøttet serie (${ranges.join(", ") || "ingen"}); en ny IntegrationCandidate og UpstreamReleaseProfile er påkrævet`);
  }
  if (editions.length && target.edition && !editions.includes(target.edition)) {
    blockers.push(`editionen '${target.edition}' er ikke understøttet (${editions.join(", ")})`);
  }
  if (candidate && !(candidate.backup?.supported === true && candidate.backup?.capability !== "unknown")) {
    blockers.push("kandidaten erklærer ikke backup som understøttet; rollback kan ikke garanteres");
  }
  if (candidate && candidate.backup?.restoreTested !== true) {
    blockers.push("kandidaten har ikke dokumenteret en afprøvet gendannelse");
  }
  const downgrade = parsed && parseVersion(current.version) ? compareVersions(target.version, current.version) < 0 : false;

  const plan = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "UpstreamUpgradePlan",
    metadata: {
      name: `${adapter}-${current.version}-til-${target.version}`.toLowerCase().replace(/[^a-z0-9.-]/g, "-"),
      version: "1.0.0",
      description: `Opgraderings- og rollbackplan for ${adapter} fra ${current.version} til ${target.version}.`,
      accountableHuman: operator,
    },
    adapter,
    from: { version: current.version, edition: current.edition ?? null },
    to: { version: target.version, edition: target.edition ?? null },
    matchesRange: matchedRange,
    downgrade,
    preflight: [
      step("negotiate", "Forhandl version/edition", "operator", "Bekræft at målversionen ligger i en understøttet serie, og at editionen er understøttet.", `integrationCandidate for ${target.version} (${target.edition ?? "—"}) findes og er godkendt`),
      step("backup-verified", "Bekræft frisk, verificeret backup", "operator", "Backup skal være taget efter sidste ændring og gendannelsen skal være verificeret i et isoleret miljø.", "backup-alder < RPO og restore-check er grøn"),
      step("capacity", "Kontrollér kapacitet og vedligeholdelsesvindue", "operator", "Der skal være plads til både gammel og ny version under skiftet, og vinduet skal være annonceret.", "ledig kapacitet og annonceret vindue"),
    ],
    steps: [
      step("drain", "Sæt adapteren i læse-/dræntilstand", "executor", "Stop nye skrivninger og lad igangværende kald afslutte.", "ingen nye skrivninger; aktive kald er afsluttet"),
      step("snapshot", "Tag øjebliksbillede og notér digest", "executor", "Tag backup umiddelbart før ændringen og notér digest/version for rollback.", "backup-digest og versionsstempel er registreret"),
      step("upgrade", "Udfør upstream-opgraderingen", "executor", "Skift container/binære og lad upstreams egne migrationer køre.", "upstream rapporterer målversionen"),
      step("unfreeze", "Genåbn for trafik", "executor", "Genoptag skrivninger efter grøn verifikation.", "adapteren svarer på health og privacy-verber"),
    ],
    verification: [
      step("health", "Health og versionsforhandling", "verifier", "Bekræft at adapterens health rapporterer målversionen som supported.", "health = ok og negotiation.status = supported"),
      step("identity", "Central identitet virker", "verifier", "Bekræft at den testede edition kan bruge den valgte centrale identitet (OIDC).", "OIDC-login og tenantbinding virker"),
      step("privacy", "Privacy-verber", "verifier", "Kør locate/export/erase med syntetiske data og bekræft den erklærede conformance.", "verbernes svar matcher releaseprofilens conformance"),
    ],
    rollback: {
      strategy: "restore-from-backup",
      backupRequired: true,
      maxDowntimeMinutes,
      steps: [
        step("rollback-restore", "Gendan øjebliksbilledet", "executor", "Gendan backup fra 'snapshot' og genstart upstream.", "upstream rapporterer den oprindelige version"),
        step("rollback-verify", "Verificér gendannelsen", "verifier", "Kør health, identitet og privacy-verber igen.", "samme kriterier som 'verification' er grønne"),
      ],
    },
    status: blockers.length ? "blocked" : "planned",
    blockers,
  };
  return plan;
}

const PLACEHOLDER = /^(n\/?a|todo|tbd|unknown|ved ikke|\.+|-+)$/i;

function err(path, message) {
  return { path, message };
}

export function isNamedHumanRef(human) {
  return Boolean(human && typeof human.subject === "string" && /^[a-z0-9._-]+\|[a-z0-9._@-]+$/i.test(human.subject) && typeof human.name === "string" && human.name.trim().length > 1);
}

/**
 * Semantiske problemer for en opgraderingsplan. Skemaet håndhæver formen; her
 * afgøres om planen må bruges som grundlag for en gated ændring.
 */
export function upgradePlanProblems(plan, { releaseProfile = null, candidate = null } = {}) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "planen er ikke et objekt")];
  if (!isNamedHumanRef(plan.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "skal være et navngivet menneske"));

  const prefix = `${plan.adapter}-`;
  if (!String(plan.metadata?.name ?? "").startsWith(prefix)) problems.push(err("/metadata/name", `skal begynde med '${prefix}'`));
  if (!parseVersion(plan.from?.version)) problems.push(err("/from/version", "skal være en eksakt version"));
  if (!parseVersion(plan.to?.version)) problems.push(err("/to/version", "skal være en eksakt version"));

  // Rollback er aldrig valgfri.
  if (plan.rollback?.backupRequired !== true) problems.push(err("/rollback/backupRequired", "backup og rollback er obligatorisk for en irreversibel opgradering"));
  if (!Array.isArray(plan.rollback?.steps) || plan.rollback.steps.length === 0) problems.push(err("/rollback/steps", "rollback skal have mindst ét trin"));
  if (!plan.rollback?.strategy || PLACEHOLDER.test(String(plan.rollback.strategy))) problems.push(err("/rollback/strategy", "rollback-strategien mangler eller er en placeholder"));

  for (const [list, at] of [[plan.preflight, "/preflight"], [plan.steps ?? [], "/steps"], [plan.verification ?? [], "/verification"]]) {
    if (!Array.isArray(list) || list.length === 0) {
      problems.push(err(at, "listen skal have mindst ét trin"));
      continue;
    }
    const ids = new Set();
    for (const [i, s] of list.entries()) {
      if (!s?.id) problems.push(err(`${at}/${i}/id`, "trinnet mangler en id"));
      else if (ids.has(s.id)) problems.push(err(`${at}/${i}/id`, `dubleret trin-id '${s.id}'`));
      ids.add(s?.id);
      if (!s?.role) problems.push(err(`${at}/${i}/role`, "trinnet mangler en rolle"));
      if (!s?.criteria || PLACEHOLDER.test(String(s.criteria).trim())) problems.push(err(`${at}/${i}/criteria`, "trinnet mangler et konkret kriterium"));
    }
  }

  // Krydsreference til releaseprofilen.
  if (releaseProfile) {
    const ranges = releaseProfile?.negotiation?.supportedRanges ?? [];
    if (parseVersion(plan.to?.version) && ranges.length && !ranges.some((r) => satisfiesRange(plan.to.version, r))) {
      problems.push(err("/to/version", `målversionen '${plan.to.version}' matcher ingen understøttet serie (${ranges.join(", ")})`));
    }
    const editions = releaseProfile?.negotiation?.supportedEditions ?? [];
    if (editions.length && plan.to?.edition && !editions.includes(plan.to.edition)) {
      problems.push(err("/to/edition", `editionen '${plan.to.edition}' er ikke understøttet (${editions.join(", ")})`));
    }
  }
  if (candidate && !(candidate.backup?.supported === true && candidate.backup?.restoreTested === true)) {
    problems.push(err("/rollback", "kandidaten erklærer ikke understøttet og afprøvet backup/gendannelse"));
  }

  if (plan.status === "planned" && (plan.blockers ?? []).length) problems.push(err("/blockers", "en planlagt plan må ikke have blockers"));
  if (plan.status === "blocked" && !(plan.blockers ?? []).length) problems.push(err("/blockers", "en blokeret plan skal navngive mindst ét konkret blocker"));
  return problems;
}

export { compareVersions };
