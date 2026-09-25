/**
 * DKC-042 — semantik for katastrofegendannelsesplanen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver de beslutninger skemaet ikke
 * kan udtrykke:
 *
 *   - 3-2-1-1-0 er det valgte driftsprincip, og de deklarerede tal stemmer med
 *     de faktiske kopier (mindst tre kopier på mindst to medier, én ekstern, én
 *     offline/immutable og mindst én verificeret restore),
 *   - primærklyngens driftscredentials må **ikke** kunne slette beskyttede
 *     backups — hverken direkte eller gennem en indirekte rolle,
 *   - applikationskonsistente backups kræver WAL-arkivering med PITR og en
 *     eksplicit ACL-afstemning; et snapshot alene er ikke bevis,
 *   - recovery-identiteten er adskilt fra driften, kun et verificeret menneske
 *     kan aktivere den, og det kræver to-personers godkendelse uden stående
 *     adgang,
 *   - recovery-miljøet er isoleret uden afhængighed af det primære IAM/DNS/
 *     secret-store, og tabet af disse indgår i øvelsen,
 *   - slettejournalen er append-only og hash-kædet,
 *   - failback er planlagt og kræver fence,
 *   - RPO/RTO er defineret for det **samlede** brugerflow med dets
 *     afhængigheder, ikke kun databaseopstart.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../../conformance/src/architecture.mjs";

export const DR_PLAN_PATH = "backup/dr/disaster-recovery-plan.json";
export const RECOVERY_ACCESS_PATH = "backup/dr/recovery-access-profile.json";

function err(path, message) {
  return { path, message };
}

export function loadDisasterRecoveryPlan(root) {
  return JSON.parse(readFileSync(join(root, DR_PLAN_PATH), "utf8"));
}

export function loadRecoveryAccessProfile(root) {
  return JSON.parse(readFileSync(join(root, RECOVERY_ACCESS_PATH), "utf8"));
}

const REQUIRED_DEPENDENCIES = ["iam", "dns", "secret-store"];

export function disasterRecoveryPlanProblems(plan, { targets = null } = {}) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "katastrofegendannelsesplanen er ikke et objekt")];

  if (!isNamedHuman(plan.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "planen skal have et navngivet menneske som ejer"));
  }

  // --- 3-2-1-1-0 ------------------------------------------------------------
  const copies = Array.isArray(plan.copies) ? plan.copies : [];
  const principle = plan.principle ?? {};
  if (principle.designation !== "3-2-1-1-0") problems.push(err("/principle/designation", "driftsprincippet skal være 3-2-1-1-0"));
  const derived = {
    copies: copies.length,
    mediaTypes: new Set(copies.map((c) => c.mediaType)).size,
    offsiteCopies: copies.filter((c) => c.copyType === "offsite").length,
    offlineImmutableCopies: copies.filter((c) => c.copyType === "offline-immutable").length,
  };
  for (const key of ["copies", "mediaTypes", "offsiteCopies", "offlineImmutableCopies"]) {
    if (Number(principle[key]) !== derived[key]) {
      problems.push(err(`/principle/${key}`, `princippet erklærer ${principle[key]}, men de faktiske kopier giver ${derived[key]}`));
    }
  }
  if (principle.verifiedRestores < 1) problems.push(err("/principle/verifiedRestores", "mindst én verificeret restore kræves"));
  if (principle.unrecoverableErrors !== 0) problems.push(err("/principle/unrecoverableErrors", "3-2-1-1-0 kræver nul uoprettelige fejl"));

  // --- Kopier og fejl-/adgangsdomæner --------------------------------------
  const targetNames = targets ? new Set(targets.map((t) => t?.metadata?.name ?? t?.name)) : null;
  const copyIds = new Set();
  for (const [i, copy] of copies.entries()) {
    const at = `/copies/${i}`;
    if (copyIds.has(copy.id)) problems.push(err(`${at}/id`, `kopien '${copy.id}' er erklæret flere gange`));
    copyIds.add(copy.id);
    if (copy.encrypted !== true) problems.push(err(`${at}/encrypted`, `kopien '${copy.id}' skal være krypteret`));
    if (copy.copyType !== "primary" && copy.deletePermission === "none" && copy.immutable === true) {
      problems.push(err(`${at}/deletePermission`, `den immutable kopi '${copy.id}' skal have en dokumenteret sletningsspærring`));
    }
    if (targetNames && !targetNames.has(copy.targetRef)) {
      problems.push(err(`${at}/targetRef`, `backupmålet '${copy.targetRef}' findes ikke blandt de konfigurerede mål`));
    }
  }
  const immutableCopies = copies.filter((c) => c.immutable === true);
  if (immutableCopies.length < 2) problems.push(err("/copies", "mindst én ekstern og én offline kopi skal være immutable"));
  const offline = copies.find((c) => c.copyType === "offline-immutable");
  if (!offline) problems.push(err("/copies", "der mangler en offline/immutable kopi"));
  else if (offline.immutable !== true) problems.push(err("/copies", "den offline kopi skal være immutable"));

  const failureDomains = new Set(copies.map((c) => c.failureDomain));
  if (failureDomains.size < 3) problems.push(err("/copies", "kopierne skal ligge i mindst tre forskellige fejldomæner"));
  const accessDomains = new Set(copies.map((c) => c.accessDomain));
  if (accessDomains.size < 2) problems.push(err("/copies", "kopierne skal ligge i mindst to forskellige adgangsdomæner"));

  // --- Primærklyngens driftscredentials ------------------------------------
  const primary = plan.primaryCluster ?? {};
  if (primary.canDeleteProtectedBackups !== false) {
    problems.push(err("/primaryCluster/canDeleteProtectedBackups", "primærklyngens driftscredentials må ikke kunne slette beskyttede backups"));
  }
  if (!(primary.forbiddenOperations ?? []).includes("delete")) {
    problems.push(err("/primaryCluster/forbiddenOperations", "sletning skal være eksplicit forbudt for primærklyngens driftsrolle"));
  }
  if (!(primary.forbiddenOperations ?? []).includes("retention-shorten")) {
    problems.push(err("/primaryCluster/forbiddenOperations", "afkortning af retention skal være forbudt for primærklyngens driftsrolle"));
  }
  for (const [i, copy] of copies.entries()) {
    if (copy.immutable !== true) continue;
    if (copy.credentialsRef === primary.credentialsRef) {
      problems.push(err(`/copies/${i}/credentialsRef`, `den immutable kopi '${copy.id}' må ikke bruge primærklyngens driftscredentials`));
    }
    if (copy.deletePermission === "none") {
      problems.push(err(`/copies/${i}/deletePermission`, `den immutable kopi '${copy.id}' skal have en sletningsspærring`));
    }
  }

  // --- Recovery-identitet ---------------------------------------------------
  const recovery = plan.recoveryIdentity ?? {};
  if (recovery.separateFromPrimaryOperations !== true) problems.push(err("/recoveryIdentity/separateFromPrimaryOperations", "recovery-adgangen skal være adskilt fra primærdriften"));
  if (recovery.humanVerifiedOnly !== true) problems.push(err("/recoveryIdentity/humanVerifiedOnly", "kun et verificeret menneske må aktivere recovery-adgang"));
  if (recovery.twoPersonApproval !== true) problems.push(err("/recoveryIdentity/twoPersonApproval", "aktivering af recovery-adgang skal kræve to-personers godkendelse"));
  if (recovery.noStandingAccess !== true) problems.push(err("/recoveryIdentity/noStandingAccess", "recovery-adgang må ikke være stående"));
  if (!(recovery.profileRef ?? "").trim()) problems.push(err("/recoveryIdentity/profileRef", "recovery-identiteten skal pege på en adgangsprofil"));

  // --- PITR og applikationskonsistens ---------------------------------------
  const pitr = plan.pitr ?? {};
  if (pitr.pitrEnabled !== true) problems.push(err("/pitr/pitrEnabled", "PITR skal være aktiveret"));
  if (pitr.consistency !== "application-consistent") problems.push(err("/pitr/consistency", "backupen skal være applikationskonsistent"));
  if (!(pitr.walArchiveTarget ?? "").trim()) problems.push(err("/pitr/walArchiveTarget", "der skal være et WAL-arkivmål"));
  if (!(pitr.retentionHours > 0)) problems.push(err("/pitr/retentionHours", "WAL-arkivet skal have en positiv retention"));
  if (pitr.snapshotAloneIsInsufficient !== true) problems.push(err("/pitr/snapshotAloneIsInsufficient", "et snapshot alene er ikke tilstrækkeligt bevis"));
  const quiescence = pitr.quiescence ?? {};
  if (!(quiescence.maxPauseSeconds > 0)) problems.push(err("/pitr/quiescence/maxPauseSeconds", "quiescence skal have et positivt maksimalt pausevindue"));
  for (const part of ["database", "config"]) {
    if (!(quiescence.includes ?? []).includes(part)) problems.push(err("/pitr/quiescence/includes", `quiescence skal omfatte '${part}'`));
  }
  const acl = pitr.aclReconciliation ?? {};
  if (acl.required !== true) problems.push(err("/pitr/aclReconciliation/required", "data og ACL skal afstemmes efter PITR"));
  if ((acl.sources ?? []).length < 2) problems.push(err("/pitr/aclReconciliation/sources", "ACL-afstemningen skal trække på mindst to kilder"));
  if (!(pitr.targetRecoveryTime?.selectable === true)) problems.push(err("/pitr/targetRecoveryTime/selectable", "det valgte recovery-tidspunkt skal kunne vælges"));

  // --- Isoleret recovery-miljø ---------------------------------------------
  const env = plan.recoveryEnvironment ?? {};
  if (env.isolated !== true) problems.push(err("/recoveryEnvironment/isolated", "recovery-miljøet skal være isoleret"));
  if (env.noPrimaryDependency !== true) problems.push(err("/recoveryEnvironment/noPrimaryDependency", "recovery-miljøet må ikke afhænge af den primære klynge"));
  if (!(env.networkIsolation ?? "").trim()) problems.push(err("/recoveryEnvironment/networkIsolation", "recovery-miljøet skal være netværksisoleret"));
  if ((env.manifests ?? []).length < 1) problems.push(err("/recoveryEnvironment/manifests", "recovery-miljøet skal have mindst ét manifest"));
  const depComponents = new Set((env.dependencies ?? []).map((d) => d.component));
  for (const required of REQUIRED_DEPENDENCIES) {
    if (!depComponents.has(required)) problems.push(err("/recoveryEnvironment/dependencies", `tabet af '${required}' skal indgå i recoveryøvelsen`));
  }

  // --- Kendt rent restorepunkt og slettejournal ----------------------------
  const clean = plan.knownCleanPoint ?? {};
  if (!(clean.backupId ?? "").trim()) problems.push(err("/knownCleanPoint/backupId", "der skal peges på et kendt rent restorepunkt"));
  if (!isNamedHuman(clean.verifiedBy)) problems.push(err("/knownCleanPoint/verifiedBy", "det kendte rene restorepunkt skal være verificeret af et navngivet menneske"));
  if (!(clean.evidenceRef ?? "").trim()) problems.push(err("/knownCleanPoint/evidenceRef", "det kendte rene restorepunkt skal have en evidensreference"));
  const journal = plan.deletionJournal ?? {};
  if (journal.appendOnly !== true) problems.push(err("/deletionJournal/appendOnly", "slettejournalen skal være append-only"));
  if (journal.hashChained !== true) problems.push(err("/deletionJournal/hashChained", "slettejournalen skal være hash-kædet"));
  if (!(journal.ledgerRef ?? "").trim()) problems.push(err("/deletionJournal/ledgerRef", "slettejournalen skal pege på en konkret ledger"));

  // --- Failback -------------------------------------------------------------
  const failback = plan.failback ?? {};
  if (failback.planned !== true) problems.push(err("/failback/planned", "failback skal være planlagt"));
  if (failback.requiresFence !== true) problems.push(err("/failback/requiresFence", "failback skal kræve fence"));
  if ((failback.procedure ?? []).length < 3) problems.push(err("/failback/procedure", "failback skal have en dokumenteret procedure"));

  // --- Samlet brugerflow ----------------------------------------------------
  const flow = plan.userFlow ?? {};
  if ((flow.steps ?? []).length < 3) problems.push(err("/userFlow/steps", "brugerflowet skal have mindst tre trin"));
  if (!Number.isFinite(flow.rpoMinutes) || !Number.isFinite(flow.rtoMinutes)) {
    problems.push(err("/userFlow", "brugerflowet skal have et RPO- og RTO-mål"));
  }
  const flowDeps = new Set(flow.includesDependencies ?? []);
  for (const required of REQUIRED_DEPENDENCIES) {
    if (!flowDeps.has(required)) problems.push(err("/userFlow/includesDependencies", `brugerflowets RPO/RTO skal omfatte tabet af '${required}'`));
  }
  const flowStepIds = new Set((flow.steps ?? []).map((s) => s.id));
  for (const [i, step] of (flow.steps ?? []).entries()) {
    for (const dep of step.dependsOn ?? []) {
      if (!flowStepIds.has(dep)) problems.push(err(`/userFlow/steps/${i}/dependsOn`, `trinnet '${step.id}' afhænger af det ukendte trin '${dep}'`));
    }
  }

  // --- Beskyttede backups ---------------------------------------------------
  const protectedCopies = plan.protectedBackups ?? [];
  if (protectedCopies.length < 1) problems.push(err("/protectedBackups", "mindst én beskyttet backup skal være erklæret"));
  for (const [i, backup] of protectedCopies.entries()) {
    const at = `/protectedBackups/${i}`;
    if (!copyIds.has(backup.copyRef)) problems.push(err(`${at}/copyRef`, `den beskyttede backup peger på den ukendte kopi '${backup.copyRef}'`));
    if (backup.twoPersonRequired !== true) problems.push(err(`${at}/twoPersonRequired`, "sletning af en beskyttet backup skal kræve to-personers godkendelse"));
    if (backup.immutableVerified !== true) problems.push(err(`${at}/immutableVerified`, "immutabiliteten af en beskyttet backup skal være verificeret"));
  }

  return problems;
}
