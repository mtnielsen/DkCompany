/**
 * DKC-054 — read-only preflight før nogen mutation.
 *
 * Preflighten ændrer intet. Den fejler lukket og blokerer hele planen, hvis et
 * scope er uklart: ikke-understøttet OS, diskformatering, overtagelse af et
 * eksisterende databaseskema, host-OS-ændring uden konkret scope, fri root til
 * en agent, eller en recoveryvej der ikke findes uden for platformen.
 */
import { KNOWN_DATA_CLASSES } from "../../configuration/src/model.mjs";

function check(id, title, status, detail) {
  return { id, title, status, detail };
}

export function hostSupported(hostScope, platforms = []) {
  const scope = hostScope?.os ?? {};
  const matrix = platforms.find((p) => p.id === scope.supportedMatrixRef);
  const problems = [];
  if (!matrix) problems.push(`OS-kombinationen '${scope.supportedMatrixRef}' findes ikke i platformmatricen`);
  if (scope.family !== "linux") problems.push(`OS-familien '${scope.family}' understøttes ikke`);
  if (scope.supportTier === "unsupported") problems.push("OS-versionen er markeret som ikke-understøttet");
  if (matrix && scope.supportTier === "lts" && matrix.supportTier !== "supported") problems.push(`'${matrix.id}' er ikke i LTS-supporttier (${matrix.supportTier})`);
  if (matrix && scope.supportTier === "extended" && matrix.supportTier === "unsupported") problems.push(`'${matrix.id}' er ikke understøttet`);
  return { ok: problems.length === 0, matrix, problems };
}

export function runPreflight({
  hostScope,
  platformMatrix,
  config = null,
  configDigest = null,
  disks = [],
  existingDatabase = null,
  executorSubject = null,
  now = Date.now(),
} = {}) {
  const checks = [];
  const blocking = [];

  const host = hostSupported(hostScope, platformMatrix?.platforms ?? platformMatrix ?? []);
  if (!host.ok) {
    blocking.push(...host.problems);
    checks.push(check("supported-os", "Understøttet Linux-LTS-matrix", "fail", host.problems.join("; ")));
  } else {
    checks.push(check("supported-os", "Understøttet Linux-LTS-matrix", "pass", `matcher ${host.matrix.id} (${host.matrix.supportTier})`));
  }

  // Diske: der må aldrig formateres, og eksisterende data skal bevares.
  const diskProblems = disks
    .filter((d) => d.formatRequested === true || d.existingDataPreserved === false)
    .map((d) => `disken '${d.id ?? d.device ?? "ukendt"}' kræver formatering`);
  if (hostScope?.diskPolicy?.formatAllowed === true || hostScope?.diskPolicy?.existingDataPreserved === false) diskProblems.push("scopet tillader diskformatering");
  if (diskProblems.length) {
    blocking.push(...diskProblems);
    checks.push(check("disk-safety", "Ingen diskformatering, eksisterende data bevares", "fail", diskProblems.join("; ")));
  } else {
    checks.push(check("disk-safety", "Ingen diskformatering, eksisterende data bevares", "pass", `${disks.length} disk(e) kontrolleret`));
  }

  // Database: et eksisterende skema må kun bruges, hvis det er navngivet og ejet.
  const dbProblems = [];
  if (existingDatabase?.schemaPresent === true) {
    if (hostScope?.databasePolicy?.adoptExistingSchema !== false) dbProblems.push("scopet tillader overtagelse af databaseskemaet");
    if (existingDatabase.ownedBySubject !== hostScope?.databasePolicy?.migrationOwnerSubject) {
      dbProblems.push(`det eksisterende skema ejes af '${existingDatabase.ownedBySubject ?? "ukendt"}' og ikke af migrationsansvarlige`);
    }
    if (existingDatabase.backupVerified !== true) dbProblems.push("der findes ingen verificeret backup af det eksisterende skema");
  }
  if (dbProblems.length) {
    blocking.push(...dbProblems);
    checks.push(check("database-safety", "Eksisterende databaseskema overtages ikke", "fail", dbProblems.join("; ")));
  } else {
    checks.push(check("database-safety", "Eksisterende databaseskema overtages ikke", "pass", existingDatabase?.schemaPresent ? "navngivet skema med verificeret backup" : "ingen eksisterende skema"));
  }

  // Host-OS: ændring kræver et konkret, oplyst scope.
  const osProblems = [];
  if (hostScope?.hostChangePolicy?.osUpgradeAllowed === true && hostScope?.hostChangePolicy?.allowedWithExplicitScope !== true) {
    osProblems.push("host-OS-ændring er tilladt uden et konkret oplyst scope");
  }
  if (osProblems.length) {
    blocking.push(...osProblems);
    checks.push(check("host-os-change", "Host-OS ændres ikke uden konkret scope", "fail", osProblems.join("; ")));
  } else {
    checks.push(check("host-os-change", "Host-OS ændres ikke uden konkret scope", "pass", hostScope?.hostChangePolicy?.osUpgradeAllowed ? "eksplicit scope foreligger" : "ingen OS-ændring"));
  }

  // Privilegieadskillelse: ingen fri root til agenter, kun scoped executor-ticket.
  const privProblems = [];
  if (hostScope?.privileges?.noRootForAgents !== true) privProblems.push("agenter har fri root");
  if (hostScope?.privileges?.executorRole !== "executor") privProblems.push("executorrollen er ikke 'executor'");
  if (hostScope?.privileges?.scopedOperationTicket !== true) privProblems.push("executor får ikke et scoped operationsticket");
  if (executorSubject && hostScope?.privileges?.brokerSubject === executorSubject) privProblems.push("broker og executor er samme identitet");
  if (privProblems.length) {
    blocking.push(...privProblems);
    checks.push(check("privilege-separation", "Ingen fri root; kun scoped operationsticket", "fail", privProblems.join("; ")));
  } else {
    checks.push(check("privilege-separation", "Ingen fri root; kun scoped operationsticket", "pass", "broker og executor er adskilte"));
  }

  // Forbudte operationer må ikke optræde i det tilladte sæt.
  const allowed = new Set(hostScope?.allowedOperations ?? []);
  const forbidden = hostScope?.forbiddenOperations ?? [];
  const overlap = forbidden.filter((op) => allowed.has(op));
  const forbiddenProblems = [...overlap.map((op) => `den forbudte operation '${op}' er tilladt`)];
  for (const required of ["format-disk", "take-over-database-schema", "change-host-os", "arbitrary-shell", "upload-script", "unsigned-package", "modify-broker-policy", "modify-package-source", "modify-payload"]) {
    if (!forbidden.includes(required)) forbiddenProblems.push(`det obligatoriske forbud '${required}' mangler`);
  }
  if (forbiddenProblems.length) {
    blocking.push(...forbiddenProblems);
    checks.push(check("forbidden-operations", "Arbitrær shell, usigneret pakke og brokerændring afvises", "fail", forbiddenProblems.join("; ")));
  } else {
    checks.push(check("forbidden-operations", "Arbitrær shell, usigneret pakke og brokerændring afvises", "pass", `${forbidden.length} forbud aktive`));
  }

  // Recovery uden for platformen må ikke kunne lukkes af operationen.
  const recoveryProblems = [];
  if (!hostScope?.recovery?.outOfBandConsoleRef) recoveryProblems.push("der mangler en recoverykonsol uden for platformen");
  if (!hostScope?.recovery?.backupRef) recoveryProblems.push("der mangler et backupkrav");
  if ((hostScope?.recovery?.stopConditions ?? []).length === 0) recoveryProblems.push("der mangler stopkriterier");
  if (recoveryProblems.length) {
    blocking.push(...recoveryProblems);
    checks.push(check("recovery-path", "Recoveryvej uden for platformen", "fail", recoveryProblems.join("; ")));
  } else {
    checks.push(check("recovery-path", "Recoveryvej uden for platformen", "pass", hostScope.recovery.outOfBandConsoleRef));
  }

  // Konfigurationen skal være den samme, hele vejen igennem.
  if (config && configDigest && config.installation) {
    const classes = (config.installation.retention ?? []).map((r) => r.dataClass);
    const missing = KNOWN_DATA_CLASSES.filter((c) => !classes.includes(c));
    if (missing.length) {
      blocking.push(`konfigurationen mangler retention for: ${missing.join(", ")}`);
      checks.push(check("config-consistency", "Konfigurationen dækker alle dataklasser", "fail", missing.join(", ")));
    } else {
      checks.push(check("config-consistency", "Konfigurationen dækker alle dataklasser", "pass", `${classes.length} klasser`));
    }
  }

  return { ok: blocking.length === 0, checks, blockingProblems: blocking };
}
