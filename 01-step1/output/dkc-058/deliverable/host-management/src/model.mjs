/**
 * DKC-058 — modellen for sikker, valgfri host- og OS-administration.
 *
 * Host-styring er slået fra som standard. Et eksplicit enrollment med
 * menneskelig out-of-band bootstrap, verificeret trust, konkret inventory og
 * klart ejerskab er forudsætningen for enhver operation. Alt er lukket:
 * operationerne er forhåndsdefinerede, payloaden er indbygget, pakker skal være
 * signerede fra en tilladt kilde, og brokerens/policyens/konfigurationens egne
 * felter må ikke ændres.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { digestOf } from "../../policy/pdp/src/crypto.mjs";
import { runbookDigest, runbookRef } from "../../approvals/src/runbook.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

export const HOST_VERBS = ["diagnose", "package-update", "drain", "reboot", "certificate-renew", "capacity-alert"];
export const READ_ONLY_HOST_VERBS = ["diagnose", "capacity-alert"];
export const MUTATING_HOST_VERBS = ["package-update", "drain", "reboot", "certificate-renew"];
export const ENROLLMENT_PATH = "host-management/enrollments/acme-prod-node1.json";
export const PROFILE_PATH = "host-management/profiles/linux-lts.json";
export const KEYRING_PATH = "host-management/dev-keyring.json";

/** Ord der aldrig må optræde i en operation eller parameter (åbne flader). */
export const FORBIDDEN_OPERATION_TOKENS = ["shell", "sh -c", "bash -c", "script", "upload", "exec", "curl", "wget", "payload-base64", "broker-config", "package-source", "policy"];

export function loadJson(relPath, root = repoRoot) {
  const full = join(root, relPath);
  if (!existsSync(full)) throw new Error(`Mangler ${relPath}`);
  return JSON.parse(readFileSync(full, "utf8"));
}

export function loadEnrollment(root = repoRoot) {
  return loadJson(ENROLLMENT_PATH, root);
}

export function loadHostProfile(root = repoRoot) {
  return loadJson(PROFILE_PATH, root);
}

export function loadPlatforms(root = repoRoot) {
  return loadJson("catalog/platforms.json", root).platforms ?? [];
}

export function loadKeyring(root = repoRoot) {
  return loadJson(KEYRING_PATH, root);
}

/** Er host-styring slået til? Standard er nej. */
export function hostManagementEnabled(enrollment) {
  return enrollment?.management?.enabled === true;
}

/** Understøttet platform? Returnerer matrix-posten eller null. */
export function supportedPlatform(enrollment, platforms = loadPlatforms()) {
  const ref = enrollment?.host?.platformRef;
  const platform = platforms.find((p) => p.id === ref) ?? null;
  if (!platform) return null;
  if (platform.os !== "linux" || platform.supportTier === "unsupported") return null;
  return platform;
}

/** Semantiske problemer for et enrollment. */
export function enrollmentProblems(enrollment, { platforms = loadPlatforms(), profile = null } = {}) {
  const problems = [];
  const at = (path, message) => problems.push({ path, message });

  if (!/^[a-z][a-z0-9-]*\|/.test(enrollment?.ownership?.ownerSubject ?? "")) at("/ownership/ownerSubject", "hosten skal have en navngiven menneskelig ejer");
  if (enrollment?.host?.os?.family !== "linux") at("/host/os/family", "kun Linux understøttes");
  if (!/^[a-f0-9]{64}$/.test(enrollment?.trust?.caFingerprint ?? "")) at("/trust/caFingerprint", "CA-fingeraftryk skal være en SHA-256");
  if (!/^[a-f0-9]{64}$/.test(enrollment?.trust?.sshHostKeyFingerprint ?? "")) at("/trust/sshHostKeyFingerprint", "SSH-hostkey-fingeraftryk skal være en SHA-256");
  if (enrollment?.trust?.verified !== true) at("/trust/verified", "tilliden skal være verificeret");
  if (enrollment?.bootstrap?.interactive !== true) at("/bootstrap/interactive", "bootstrap skal være interaktiv og menneskelig");
  if (!/^[a-z][a-z0-9-]*\|/.test(enrollment?.bootstrap?.performedBy ?? "")) at("/bootstrap/performedBy", "bootstrap skal udføres af et navngivet menneske");

  const platform = supportedPlatform(enrollment, platforms);
  if (!platform) at("/host/platformRef", `OS-kombinationen '${enrollment?.host?.platformRef}' er ikke en understøttet Linux-platform`);
  else if (profile && profile.platformRef !== enrollment.host.platformRef) at("/host/platformRef", `enrollment-platformen '${enrollment.host.platformRef}' matcher ikke profilen '${profile.platformRef}'`);

  if (enrollment?.management?.enabled === true) {
    if (!/^[a-z][a-z0-9-]*\|/.test(enrollment?.management?.enabledBy ?? "")) at("/management/enabledBy", "host-styring skal slås til af et navngivet menneske");
    if (!enrollment?.management?.enabledAt) at("/management/enabledAt", "host-styring skal have et aktiveringstidspunkt");
    if (!enrollment?.management?.profileRef) at("/management/profileRef", "host-styring skal referere til en profil");
  } else {
    if (enrollment?.management?.enabledBy !== null) at("/management/enabledBy", "slået-fra host-styring må ikke have en aktiveringsansvarlig");
    if (enrollment?.management?.enabledAt !== null) at("/management/enabledAt", "slået-fra host-styring må ikke have et aktiveringstidspunkt");
  }

  if (enrollment?.recovery?.tested !== true) at("/recovery/tested", "recoverykonsollen skal være testet");
  if (enrollment?.securityDomain?.separateFromPlatform !== true) at("/securityDomain/separateFromPlatform", "immutable-nøgler og autoritative kopier skal ligge i et separat sikkerhedsdomæne");
  if ((enrollment?.inventory?.cpuCores ?? 0) < 1 || (enrollment?.inventory?.memoryMiB ?? 0) < 256) at("/inventory", "inventory skal have mindst 1 CPU og 256 MiB");
  return problems;
}

/** Semantiske problemer for en host-profil. */
export function profileProblems(profile, { platforms = loadPlatforms() } = {}) {
  const problems = [];
  const at = (path, message) => problems.push({ path, message });

  const platform = platforms.find((p) => p.id === profile?.platformRef);
  if (!platform) at("/platformRef", `platformen '${profile?.platformRef}' findes ikke i platformmatricen`);
  else {
    if (platform.os !== "linux") at("/platformRef", "kun Linux understøttes");
    if (platform.supportTier === "unsupported") at("/platformRef", "ikke-understøttede OS-versioner afvises");
    if (profile?.os?.supportTier === "lts" && platform.supportTier !== "supported") at("/os/supportTier", `'${platform.id}' er ikke i LTS-supporttier`);
  }

  const verbs = (profile?.operations ?? []).map((o) => o.verb);
  for (const verb of HOST_VERBS) {
    if (!verbs.includes(verb)) at("/operations", `operationen '${verb}' mangler i profilen`);
  }
  for (const op of profile?.operations ?? []) {
    if (op.requiresApproval !== true) at(`/operations/${op.verb}/requiresApproval`, "enhver host-operation kræver menneskelig godkendelse");
    if (!["diagnose", "capacity-alert"].includes(op.verb) && !(op.modes ?? []).includes("dry-run")) at(`/operations/${op.verb}/modes`, "en muterende operation skal kunne køres som dry-run først");
    if ((op.maxDurationSeconds ?? 0) <= 0) at(`/operations/${op.verb}/maxDurationSeconds`, "varigheden skal være positiv");
  }
  if (profile?.canary?.maxHosts !== 1) at("/canary/maxHosts", "canary må kun omfatte én host ad gangen");
  if (profile?.canary?.onFailure !== "halt") at("/canary/onFailure", "canary-fejl skal stoppe forløbet");
  if (profile?.backup?.verifiedBeforeMutation !== true) at("/backup/verifiedBeforeMutation", "backup skal være verificeret før mutation");
  if ((profile?.stopCriteria ?? []).length === 0) at("/stopCriteria", "der skal være mindst ét stopkriterium");
  if (profile?.recovery?.outOfBandConsole !== true) at("/recovery/outOfBandConsole", "der kræves en recoverykonsol uden for platformen");
  if (profile?.recovery?.separateSecurityDomain !== true) at("/recovery/separateSecurityDomain", "recoverykonsollen skal ligge i et separat sikkerhedsdomæne");
  if (profile?.vps?.controlsHypervisor !== false || profile?.vps?.controlsHardware !== false) at("/vps", "en VPS-profil må ikke love styring af hypervisor eller hardware");
  if ((profile?.ha?.minNodes ?? 0) < 3) at("/ha/minNodes", "HA kræver mindst tre noder");
  if (profile?.ha?.rebootOneAtATime !== true) at("/ha/rebootOneAtATime", "HA-reboot skal ske én node ad gangen");
  if (profile?.singleServer?.announcedDowntime !== true) at("/singleServer/announcedDowntime", "single-server kræver annonceret nedetid");
  return problems;
}

/** Byg et ref → digest-kort over de signerede host-runbooks. */
export function knownHostRunbooks(root = repoRoot) {
  const map = new Map();
  const dir = join(root, "runbooks");
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".runbook.json")).sort()) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (data?.metadata?.name && data?.metadata?.version) map.set(runbookRef(data), runbookDigest(data));
    } catch {
      /* runbook-validatoren rapporterer */
    }
  }
  return map;
}

/** Semantiske problemer for en host-operation. */
export function operationProblems(operation, { enrollment = null, profile = null, runbooks = null } = {}) {
  const problems = [];
  const at = (path, message) => problems.push({ path, message });
  const verb = operation?.operation?.verb;

  if (!HOST_VERBS.includes(verb)) at("/operation/verb", `ukendt host-operation '${verb}'`);
  if (operation?.operation?.target !== `host/${operation?.hostRef}`) at("/operation/target", "målet skal være 'host/<hostRef>'");
  if (operation?.restrictions?.arbitraryShell !== false) at("/restrictions/arbitraryShell", "arbitrær shell er ikke tilladt");
  if (operation?.restrictions?.uploadedScript !== false) at("/restrictions/uploadedScript", "uploadede scripts er ikke tilladt");
  if (operation?.restrictions?.brokerConfigChange !== false) at("/restrictions/brokerConfigChange", "brokerens konfiguration må ikke ændres");
  if (operation?.restrictions?.immutableWrite !== false) at("/restrictions/immutableWrite", "en host-operation må ikke skrive immutable data");
  if (operation?.restrictions?.externalKeyDestroy !== false) at("/restrictions/externalKeyDestroy", "en host-operation må ikke destruere eksterne nøgler");
  if (operation?.payload?.type !== "builtin") at("/payload/type", "kun indbyggede operationer er tilladt");

  // Ingen åbne flader i operationen.
  const flat = stableStringify(operation?.operation ?? {}).toLowerCase();
  for (const token of FORBIDDEN_OPERATION_TOKENS) {
    if (flat.includes(token)) at("/operation", `operationen indeholder den forbudte token '${token}'`);
  }

  // Pakkeopdateringer kræver en signeret, allowlistet pakke.
  if (verb === "package-update") {
    if (!operation?.package) at("/package", "en pakkeopdatering kræver en pakke");
    else {
      if (!/^[a-f0-9]{64}$/.test(operation.package.digest ?? "")) at("/package/digest", "pakken skal have en SHA-256-digest");
      if (operation.package.signatureVerified !== true) at("/package/signatureVerified", "pakken skal være signaturverificeret");
      if (operation.package.sourceAllowlisted !== true) at("/package/sourceAllowlisted", "pakkekilden skal være på allowlisten");
    }
  }

  // Menneskeautorisation.
  const approval = operation?.approval ?? {};
  if (!/^[a-z][a-z0-9-]*\|/.test(approval.humanSubject ?? "")) at("/approval/humanSubject", "operationen kræver en navngiven menneskelig godkendelse");
  const granted = Date.parse(approval.approvedAt ?? "");
  const expires = Date.parse(approval.expiresAt ?? "");
  if (Number.isFinite(granted) && Number.isFinite(expires) && expires <= granted) at("/approval/expiresAt", "godkendelsen skal udløbe efter den blev givet");
  if (runbooks && approval.runbookRef && runbooks.has(approval.runbookRef) && runbooks.get(approval.runbookRef) !== approval.runbookDigest) {
    at("/approval/runbookDigest", `runbook-digesten matcher ikke den registrerede version '${approval.runbookRef}'`);
  }
  if (approval.decisionDigest && approval.decisionDigest !== operationContentDigest(operation)) {
    at("/approval/decisionDigest", "godkendelsens digest matcher ikke operationens indhold");
  }

  // Backup, vindue og stopkriterier.
  if (MUTATING_HOST_VERBS.includes(verb) && operation?.safety?.backupVerified !== true) at("/safety/backupVerified", "en muterende operation kræver en verificeret backup");
  if ((operation?.safety?.stopCriteria ?? []).length === 0) at("/safety/stopCriteria", "der skal være mindst ét stopkriterium");
  if (!operation?.safety?.recoveryConsoleRef) at("/safety/recoveryConsoleRef", "der kræves en recoverykonsol uden for platformen");

  // Single-server vs. HA.
  const mode = operation?.scope?.mode;
  if (mode === "single-server") {
    if ((operation?.safety?.announcedDowntimeSeconds ?? 0) <= 0) at("/safety/announcedDowntimeSeconds", "single-server kræver annonceret nedetid");
  } else if (mode === "ha") {
    if ((operation?.scope?.nodeCount ?? 0) < 3) at("/scope/nodeCount", "HA kræver mindst tre noder");
  } else {
    at("/scope/mode", "scope.mode skal være 'single-server' eller 'ha'");
  }
  if (operation?.scope?.canary?.waitSeconds !== undefined && operation.scope.canary.waitSeconds < 30) at("/scope/canary/waitSeconds", "canary-observationen skal vare mindst 30 sekunder");

  // Enrollment og profil.
  if (enrollment) {
    if (!hostManagementEnabled(enrollment)) at("/management", "host-styring er ikke slået til for denne host");
    if (enrollment.host?.id !== operation?.hostRef) at("/hostRef", "operationen peger på en anden host end enrollmentet");
  }
  if (profile) {
    const op = (profile.operations ?? []).find((o) => o.verb === verb);
    if (!op) at("/operation/verb", `operationen '${verb}' findes ikke i host-profilen`);
    else if (!(op.modes ?? []).includes(operation?.operation?.dryRun ? "dry-run" : "apply")) at("/operation/dryRun", `tilstanden '${operation?.operation?.dryRun ? "dry-run" : "apply"}' er ikke tilladt for '${verb}'`);
  }
  return problems;
}

/** En deterministisk digest for en operation (til signering). */
export function operationContentDigest(operation) {
  const clone = JSON.parse(JSON.stringify(operation ?? {}));
  if (clone.signature) delete clone.signature;
  if (clone.approval) {
    clone.approval = { ...clone.approval };
    delete clone.approval.decisionDigest;
  }
  return digestOf(clone);
}
