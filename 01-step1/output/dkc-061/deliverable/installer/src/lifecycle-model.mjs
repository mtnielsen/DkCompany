/**
 * DKC-061 — model og beslutningssemantik for produktlivscyklussen.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - et signeret releasekatalog med supportvindue, EOL-status, vedtaget
 *     håndtering, kompatibilitetslås og en sikkerhedsopdateringsprocedure. En
 *     tilbagekaldt release må ikke kunne køres, og en usigneret eller ulåst
 *     release afvises,
 *   - en opdateringsplan med påvirkning, migrationskontrol, read-only
 *     preflight, rollback/gendannelse og menneskelig godkendelse,
 *   - en fjernelsesplan der holder fjernelse adskilt fra datasletning, laver
 *     reverse-dependency-kontrol og kræver eksport/backup og eksplicit
 *     destruktiv godkendelse,
 *   - en redigeret supportbundle- og diagnostikpolitik uden hemmeligheder eller
 *     ikke-godkendt HR-indhold og uden skjult fjernadgang, og
 *   - en offlinepakke hvor lokale kerneflows består, og hver ekstern
 *     afhængighed er markeret med en eksplicit offline-adfærd.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { stableStringify } from "../../approvals/src/binding.mjs";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const RELEASE_CATALOG_PATH = "catalog/releases.json";
export const SUPPORT_POLICY_PATH = "support/policy.json";
export const OFFLINE_PACKAGE_PATH = "catalog/offline-package.json";
export const REPORT_PATH = "lifecycle/report/lifecycle-report.json";
export const REPORT_DOC_PATH = "docs/lifecycle/lifecycle-report.md";
export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

export const RELEASE_CHANNELS = ["stable", "security", "eol", "revoked"];

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadReleaseCatalog(root) {
  return readJson(root, RELEASE_CATALOG_PATH);
}
export function loadSupportPolicy(root) {
  return readJson(root, SUPPORT_POLICY_PATH);
}
export function loadOfflinePackage(root) {
  return readJson(root, OFFLINE_PACKAGE_PATH);
}
export function loadComponents(root) {
  const dir = join(root, "catalog", "components");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".component.json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")));
}
export function loadGatewayRoutes(root) {
  const path = join(root, "gateway", "routes.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")).routes ?? [];
}
export function loadAll(root) {
  return { catalog: loadReleaseCatalog(root), support: loadSupportPolicy(root), offline: loadOfflinePackage(root), components: loadComponents(root), routes: loadGatewayRoutes(root) };
}

export function releaseById(catalog, id) {
  return (catalog?.releases ?? []).find((r) => r.id === id) ?? null;
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Signering og verifikation                                                  */
/* -------------------------------------------------------------------------- */

export function canonicalRelease(release) {
  const { digest, ...rest } = release ?? {};
  return JSON.parse(JSON.stringify(rest));
}
export function releaseDigest(release) {
  return sha256(canonicalRelease(release));
}
export function canonicalArtifact(artifact) {
  return { name: artifact?.name, digest: artifact?.digest };
}
export function artifactSignatureValue(secret, artifact) {
  return createHmac("sha256", secret).update(stableStringify(canonicalArtifact(artifact))).digest("hex");
}
export function canonicalCatalog(catalog) {
  const { signature, ...rest } = catalog ?? {};
  return JSON.parse(JSON.stringify(rest));
}
export function catalogDigest(catalog) {
  return sha256(canonicalCatalog(catalog));
}

function lookupKey(keyring, keyId) {
  if (!keyring || !keyId) return null;
  if (Array.isArray(keyring.keys)) return keyring.keys.find((k) => k.keyId === keyId) ?? null;
  return keyring[keyId] ? { keyId, secret: keyring[keyId] } : null;
}

/** Signér et releasekatalog deterministisk: release-digests, artefaktsignaturer og topniveau-signatur. */
export function signReleaseCatalog(catalog, { keyId, secret } = {}) {
  if (!keyId || !secret) throw new Error("signReleaseCatalog kræver keyId og secret");
  const signed = JSON.parse(JSON.stringify(canonicalCatalog(catalog)));
  for (const release of signed.releases ?? []) {
    for (const artifact of release.artifacts ?? []) {
      artifact.signature = { algorithm: "hmac-sha256", keyId, value: artifactSignatureValue(secret, artifact) };
    }
    release.digest = releaseDigest(release);
  }
  const value = createHmac("sha256", secret).update(stableStringify(canonicalCatalog(signed))).digest("hex");
  signed.signature = { algorithm: "hmac-sha256", keyId, value };
  return signed;
}

function verifyHmac(secret, value, canonical) {
  const expected = createHmac("sha256", secret).update(stableStringify(canonical)).digest("hex");
  const a = Buffer.from(String(value), "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Verificér katalog-, release- og artefaktsignaturer. Returnerer {ok, problems}. */
export function verifyReleaseCatalog(catalog, keyring) {
  const problems = [];
  const signature = catalog?.signature;
  if (!signature) return { ok: false, problems: ["releasekataloget er ikke signeret"] };
  if (signature.algorithm !== "hmac-sha256") problems.push(`ukendt signaturalgoritme '${signature.algorithm}'`);
  const key = lookupKey(keyring, signature.keyId);
  if (!key) problems.push(`signeringsnøglen '${signature.keyId}' er ikke kendt`);
  else if (key.revokedAt) problems.push(`signeringsnøglen '${signature.keyId}' er tilbagekaldt`);
  else if (!verifyHmac(key.secret, signature.value, canonicalCatalog(catalog))) problems.push("releasekatalogets signatur matcher ikke indholdet");
  for (const release of catalog?.releases ?? []) {
    if (release.digest !== releaseDigest(release)) problems.push(`release '${release.id}' har et digest der ikke matcher indholdet`);
    for (const artifact of release.artifacts ?? []) {
      const artSig = artifact.signature;
      if (!artSig) {
        problems.push(`artefaktet '${artifact.name}' i release '${release.id}' er ikke signeret`);
        continue;
      }
      if (!key) continue;
      if (!verifyHmac(key.secret, artSig.value, canonicalArtifact(artifact))) problems.push(`artefaktet '${artifact.name}' i release '${release.id}' har en signatur der ikke matcher`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/* -------------------------------------------------------------------------- */
/* Releasekatalog                                                             */
/* -------------------------------------------------------------------------- */

export function releaseCatalogProblems(catalog, { keyring = null, components = [], now = Date.now() } = {}) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return [err("/", "releasekataloget er ikke et objekt")];
  if (!isNamedHuman(catalog.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "releasekataloget skal have et navngivet menneske som ejer"));
  const policy = catalog.policy ?? {};
  for (const flag of ["requireSignature", "requireCompatibilityLock", "requireProvenance", "requireSbom"]) {
    if (policy[flag] !== true) problems.push(err(`/policy/${flag}`, `releasepolitikken skal kræve ${flag}`));
  }
  if (policy.revokedNeverRunnable !== true) problems.push(err("/policy/revokedNeverRunnable", "en tilbagekaldt release må ikke kunne køre"));
  if (policy.eolRequiresHandling !== true) problems.push(err("/policy/eolRequiresHandling", "en EOL-release skal have en vedtaget håndtering"));
  if (policy.securityUpdateRequiresAdvisory !== true) problems.push(err("/policy/securityUpdateRequiresAdvisory", "en sikkerhedsopdatering skal pege på en advisory"));
  if (!Array.isArray(policy.promotionPath) || !policy.promotionPath.includes("stable")) problems.push(err("/policy/promotionPath", "forfremmelsesvejen skal indeholde stable"));

  const componentVersion = new Map(components.map((c) => [c.metadata?.name, c.metadata?.version]));
  const ids = new Set();
  const channels = new Set();
  for (const [i, release] of (catalog.releases ?? []).entries()) {
    const at = `/releases/${i}`;
    if (!/^\d+\.\d+\.\d+$/.test(release.id ?? "")) problems.push(err(`${at}/id`, `release-id'et '${release.id}' er ugyldigt`));
    if (ids.has(release.id)) problems.push(err(`${at}/id`, `release-id'et '${release.id}' er dubleret`));
    ids.add(release.id);
    if (!RELEASE_CHANNELS.includes(release.channel)) problems.push(err(`${at}/channel`, `release '${release.id}' har den ukendte kanal '${release.channel}'`));
    channels.add(release.channel);
    if (!(policy.promotionPath ?? []).includes(release.channel)) problems.push(err(`${at}/channel`, `kanalen '${release.channel}' er ikke en del af forfremmelsesvejen`));
    const from = Date.parse(release.supportWindow?.from ?? "");
    const until = Date.parse(release.supportWindow?.until ?? "");
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) problems.push(err(`${at}/supportWindow`, `release '${release.id}' har et ugyldigt supportvindue`));
    if (release.channel === "eol" || release.channel === "revoked") {
      if (!release.eolAt) problems.push(err(`${at}/eolAt`, `release '${release.id}' i kanalen '${release.channel}' skal have en EOL-dato`));
      if (!(release.handling ?? "").trim()) problems.push(err(`${at}/handling`, `release '${release.id}' i kanalen '${release.channel}' skal have en vedtaget håndtering`));
    }
    if (release.channel === "revoked" && release.eolAt && Date.parse(release.eolAt) > now) problems.push(err(`${at}/eolAt`, `en tilbagekaldt release kan ikke have en fremtidig EOL-dato`));
    const lock = release.compatibilityLock ?? {};
    if (Object.keys(lock).length === 0) problems.push(err(`${at}/compatibilityLock`, `release '${release.id}' mangler en kompatibilitetslås`));
    for (const [id, version] of Object.entries(lock)) {
      if (!components.length) continue;
      if (!componentVersion.has(id)) problems.push(err(`${at}/compatibilityLock/${id}`, `kompatibilitetslåsen peger på den ukendte komponent '${id}'`));
      else if (release.channel === "stable" && componentVersion.get(id) !== version) problems.push(err(`${at}/compatibilityLock/${id}`, `den stabile release '${release.id}' låser '${id}' til ${version}, men katalogets version er ${componentVersion.get(id)}`));
    }
    for (const [j, artifact] of (release.artifacts ?? []).entries()) {
      if (!/^[a-f0-9]{64}$/.test(artifact.digest ?? "")) problems.push(err(`${at}/artifacts/${j}/digest`, `artefaktet '${artifact.name}' mangler et gyldigt digest`));
    }
    for (const [j, update] of (release.securityUpdates ?? []).entries()) {
      if (!update.advisoryId?.trim()) problems.push(err(`${at}/securityUpdates/${j}/advisoryId`, `release '${release.id}' har en sikkerhedsopdatering uden advisory`));
      if (!(update.procedure ?? "").trim()) problems.push(err(`${at}/securityUpdates/${j}/procedure`, `release '${release.id}' har en sikkerhedsopdatering uden procedure`));
      if (!ids.has(update.fixedIn) && !(catalog.releases ?? []).some((r) => r.id === update.fixedIn)) problems.push(err(`${at}/securityUpdates/${j}/fixedIn`, `sikkerhedsopdateringen peger på den ukendte release '${update.fixedIn}'`));
    }
  }
  for (const channel of RELEASE_CHANNELS) {
    if (!channels.has(channel)) problems.push(err("/releases", `releasekataloget mangler en release i kanalen '${channel}'`));
  }
  if (keyring) {
    const verified = verifyReleaseCatalog(catalog, keyring);
    for (const p of verified.problems) problems.push(err("/signature", p));
  }
  return problems;
}

/** Kanaler der ikke må bruges som opdateringsmål. */
export function releaseRunnable(release) {
  return release?.channel === "stable" || release?.channel === "security";
}

/* -------------------------------------------------------------------------- */
/* Supportpolitik og supportbundle                                            */
/* -------------------------------------------------------------------------- */

export const FORBIDDEN_HR_KEYS = ["salary", "payroll", "unionMembership", "union_membership", "sickLeave", "sick_leave", "healthRecord", "health_record", "hrCase", "hr_case", "hrPersonal", "hr_personal", "performanceReview", "performance_review"];
/** @deprecated brug FORBIDDEN_HR_KEYS; beholdt for bagudkompatibilitet. */
export const FORBIDDEN_SUPPORT_KEYS = [...FORBIDDEN_HR_KEYS, "secret", "password", "passwd", "token", "apikey", "api_key", "privatekey", "private_key", "credential"];

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z]/g, "");
}

/** Find forbudte nøgler/indholdsklasser rekursivt i et objekt. */
export function scanForbiddenContent(value, { forbiddenKeys = FORBIDDEN_HR_KEYS, path = "" } = {}) {
  const findings = [];
  const forbidden = new Set(forbiddenKeys.map((k) => normalizedKey(k)));
  const walk = (node, at) => {
    if (Array.isArray(node)) return node.forEach((child, i) => walk(child, `${at}/${i}`));
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (forbidden.has(normalizedKey(key))) findings.push(`${at}/${key}`);
        walk(child, `${at}/${key}`);
      }
    }
  };
  walk(value, path);
  return findings;
}

export function supportPolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "supportpolitikken er ikke et objekt")];
  if (!isNamedHuman(policy.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "supportpolitikken skal have et navngivet menneske som ejer"));
  const p = policy.policy ?? {};
  if (p.redactionRequired !== true) problems.push(err("/policy/redactionRequired", "supportbundlen skal redigeres"));
  if (p.secretScanRequired !== true) problems.push(err("/policy/secretScanRequired", "supportbundlen skal scannes for hemmeligheder"));
  if (p.hrContentAllowed !== false) problems.push(err("/policy/hrContentAllowed", "HR-indhold må ikke være tilladt i supportbundlen"));
  if (!Array.isArray(p.forbiddenContentClasses) || !["secret", "hr-personal", "payroll"].every((c) => p.forbiddenContentClasses.includes(c))) {
    problems.push(err("/policy/forbiddenContentClasses", "hemmeligheder, HR-personalier og løn skal være forbudte indholdsklasser"));
  }
  if (p.remoteAccessDefaultDeny !== true) problems.push(err("/policy/remoteAccessDefaultDeny", "fjernadgang skal være default-deny"));
  if (p.hiddenRemoteAccessAllowed !== false) problems.push(err("/policy/hiddenRemoteAccessAllowed", "skjult fjernadgang må ikke være tilladt"));
  if (p.remoteAccessRequiresHumanConsent !== true) problems.push(err("/policy/remoteAccessRequiresHumanConsent", "fjernadgang skal kræve menneskeligt samtykke"));
  if (!(p.remoteAccessMaxTtlMinutes >= 1 && p.remoteAccessMaxTtlMinutes <= 480)) problems.push(err("/policy/remoteAccessMaxTtlMinutes", "fjernadgangens TTL skal være mellem 1 og 480 minutter"));
  if (p.auditRemoteAccess !== true) problems.push(err("/policy/auditRemoteAccess", "fjernadgang skal revisionslogges"));
  const ids = new Set();
  for (const [i, entry] of (policy.allowlist ?? []).entries()) {
    if (!entry.id?.trim()) problems.push(err(`/allowlist/${i}/id`, "allowlist-posten mangler et id"));
    if (ids.has(entry.id)) problems.push(err(`/allowlist/${i}/id`, `allowlist-id'et '${entry.id}' er dubleret`));
    ids.add(entry.id);
  }
  if (!ids.size) problems.push(err("/allowlist", "supportpolitikken skal have en allowlist"));
  return problems;
}

export function supportBundleDigest(bundle) {
  const { digest, ...rest } = bundle ?? {};
  return sha256(rest);
}

export function supportBundleProblems(bundle, { policy = null } = {}) {
  const problems = [];
  if (!bundle || typeof bundle !== "object") return [err("/", "supportbundlen er ikke et objekt")];
  if (bundle.redacted !== true) problems.push(err("/redacted", "supportbundlen skal være redigeret"));
  if (bundle.secretScan !== "pass") problems.push(err("/secretScan", "supportbundlen indeholder hemmelighedssignaturer"));
  if (bundle.hrScan !== "pass") problems.push(err("/hrScan", "supportbundlen indeholder ikke-godkendt HR-indhold"));
  const findings = scanForbiddenContent(bundle.content);
  for (const finding of findings) problems.push(err(`/content${finding}`, "supportbundlen indeholder et forbudt felt"));
  if (bundle.digest !== supportBundleDigest(bundle)) problems.push(err("/digest", "supportbundlens digest matcher ikke indholdet"));

  const allowed = new Set((policy?.allowlist ?? []).map((e) => e.id));
  for (const [i, entry] of (bundle.collected ?? []).entries()) {
    if (allowed.size && !allowed.has(entry.id)) problems.push(err(`/collected/${i}/id`, `den indsamlede post '${entry.id}' er ikke på allowlisten`));
  }

  const remote = bundle.remoteAccess ?? {};
  if (remote.hiddenAccess === true) problems.push(err("/remoteAccess/hiddenAccess", "der må ikke findes skjult fjernadgang"));
  if (remote.enabled === true) {
    if (!isNamedHuman({ subject: remote.consentRef, name: "Support Consent", role: "Consent" })) {
      problems.push(err("/remoteAccess/consentRef", "aktiveret fjernadgang skal have et navngivent menneskes samtykke"));
    }
    const ttl = remote.ttlMinutes;
    const max = policy?.policy?.remoteAccessMaxTtlMinutes ?? 480;
    if (!(ttl >= 1 && ttl <= max)) problems.push(err("/remoteAccess/ttlMinutes", `fjernadgangens TTL skal være mellem 1 og ${max} minutter`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Offlinepakke og eksterne afhængigheder                                     */
/* -------------------------------------------------------------------------- */

export function offlinePackageProblems(pkg, { components = [], routes = [] } = {}) {
  const problems = [];
  if (!pkg || typeof pkg !== "object") return [err("/", "offlinepakken er ikke et objekt")];
  if (!isNamedHuman(pkg.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "offlinepakken skal have et navngivet menneske som ejer"));
  const p = pkg.policy ?? {};
  if (p.coreFlowsRemainLocal !== true) problems.push(err("/policy/coreFlowsRemainLocal", "lokale kerneflows skal bestå offline"));
  if (p.externalOutageVisible !== true) problems.push(err("/policy/externalOutageVisible", "et eksternt udfald skal vises tydeligt"));
  if (p.noSilentFallback !== true) problems.push(err("/policy/noSilentFallback", "der må ikke findes en tavs fallback"));
  if (p.packageSelfContained !== true) problems.push(err("/policy/packageSelfContained", "offlinepakken skal være selvstændig"));
  if (p.externalDependencyRegistryComplete !== true) problems.push(err("/policy/externalDependencyRegistryComplete", "hver ekstern afhængighed skal være registreret"));

  const componentVersion = new Map(components.map((c) => [c.metadata?.name, c.metadata?.version]));
  const componentIds = new Set();
  for (const [i, component] of (pkg.components ?? []).entries()) {
    if (componentIds.has(component.id)) problems.push(err(`/components/${i}/id`, `komponenten '${component.id}' er dubleret`));
    componentIds.add(component.id);
    if (components.length && !componentVersion.has(component.id)) problems.push(err(`/components/${i}/id`, `offlinepakken peger på den ukendte komponent '${component.id}'`));
    if (components.length && componentVersion.has(component.id) && componentVersion.get(component.id) !== component.version) {
      problems.push(err(`/components/${i}/version`, `offlinepakken for '${component.id}' (${component.version}) matcher ikke katalogets version (${componentVersion.get(component.id)})`));
    }
  }

  const dependencyIds = new Set();
  const routeCovered = new Set();
  for (const [i, dep] of (pkg.externalDependencies ?? []).entries()) {
    if (dependencyIds.has(dep.id)) problems.push(err(`/externalDependencies/${i}/id`, `den eksterne afhængighed '${dep.id}' er dubleret`));
    dependencyIds.add(dep.id);
    if (dep.offlineBehavior === "local-fallback" && !(dep.localFallbackRef ?? "").trim()) problems.push(err(`/externalDependencies/${i}/localFallbackRef`, `afhængigheden '${dep.id}' mangler en lokal fallback`));
    if (!(dep.explicitStatus ?? "").trim()) problems.push(err(`/externalDependencies/${i}/explicitStatus`, `afhængigheden '${dep.id}' mangler en eksplicit status ved udfald`));
    for (const route of dep.routeRefs ?? []) routeCovered.add(route);
  }
  for (const route of routes) {
    if (!routeCovered.has(route.id)) problems.push(err("/externalDependencies", `gateway-ruten '${route.id}' er ikke markeret som ekstern afhængighed`));
  }

  const localFlows = (pkg.coreFlows ?? []).filter((f) => f.local === true);
  if (!localFlows.length) problems.push(err("/coreFlows", "offlinepakken skal have mindst ét lokalt kerneflow"));
  for (const [i, flow] of (pkg.coreFlows ?? []).entries()) {
    if (flow.local !== true) problems.push(err(`/coreFlows/${i}/local`, `kerneflowet '${flow.id}' skal kunne køre lokalt`));
    for (const dep of flow.externalDependencies ?? []) {
      if (!dependencyIds.has(dep)) problems.push(err(`/coreFlows/${i}/externalDependencies`, `kerneflowet '${flow.id}' peger på den ukendte eksterne afhængighed '${dep}'`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Opdaterings- og fjernelsesplaner                                           */
/* -------------------------------------------------------------------------- */

export function updatePlanProblems(plan, { now = Date.now() } = {}) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "opdateringsplanen er ikke et objekt")];
  const at = (path, message) => problems.push(err(path, message));
  if (plan.migrationCheck?.required === true && (plan.migrationCheck.phases ?? []).length === 0) at("/migrationCheck/phases", "en påkrævet migrering skal angive sine faser");
  if (plan.preflight?.ok === false && (plan.preflight.blockingProblems ?? []).length === 0) at("/preflight/blockingProblems", "en fejlende preflight skal angive de blokerende problemer");
  if (plan.authorization?.required === true && !isNamedHuman({ subject: plan.authorization.humanSubject, name: "Approver", role: "Approver" })) {
    at("/authorization/humanSubject", "en påkrævet godkendelse skal komme fra et navngivent menneske");
  }
  if (plan.rollback?.strategy === "none") at("/rollback/strategy", "en opdatering skal have en rollback- eller gendannelsesvej");
  if (plan.rollback && plan.rollback.strategy !== "none" && !plan.rollback.documentedProcedureRef) at("/rollback/documentedProcedureRef", "rollback skal henvise til en dokumenteret procedure");
  const r = plan.restrictions ?? {};
  if (r.preserveData !== true) at("/restrictions/preserveData", "opdateringen skal bevare data");
  if (r.formatDisks !== false) at("/restrictions/formatDisks", "opdateringen må ikke formatere diske");
  if (r.adoptExistingSchema !== false) at("/restrictions/adoptExistingSchema", "opdateringen må ikke overtage et eksisterende skema");
  if (r.unsignedPackage !== false) at("/restrictions/unsignedPackage", "opdateringen må ikke bruge en usigneret pakke");
  const ids = new Set();
  const order = new Map((plan.steps ?? []).map((s) => [s.id, s.order]));
  for (const [i, step] of (plan.steps ?? []).entries()) {
    if (ids.has(step.id)) at(`/steps/${i}/id`, `dubleret trin-id '${step.id}'`);
    ids.add(step.id);
    for (const dep of step.dependsOn ?? []) {
      if (!order.has(dep)) at(`/steps/${i}/dependsOn`, `trinnet afhænger af det ukendte trin '${dep}'`);
      else if (order.get(dep) >= step.order) at(`/steps/${i}/dependsOn`, `trinnet afhænger af '${dep}', som ikke kommer før det`);
    }
    if (step.mutating === true && step.requiresApproval !== true) at(`/steps/${i}/requiresApproval`, "et muterende trin skal kræve menneskelig godkendelse");
  }
  if (plan.metadata?.createdAt && Date.parse(plan.metadata.createdAt) > now + 60000) at("/metadata/createdAt", "planen er dateret i fremtiden");
  return problems;
}

export function removalPlanProblems(plan, { now = Date.now() } = {}) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "fjernelsesplanen er ikke et objekt")];
  const at = (path, message) => problems.push(err(path, message));
  const requiredDependents = (plan.reverseDependencies ?? []).filter((d) => d.required === true);
  if (requiredDependents.length > 0 && plan.blocking !== true) at("/blocking", "en fjernelse med aktive påkrævede afhængigheder skal blokere");
  if (requiredDependents.length > 0 && plan.preflight?.ok !== false) at("/preflight/ok", "en blokeret fjernelse skal have en fejlende preflight");
  const r = plan.restrictions ?? {};
  if (r.separateFromDataDeletion !== true) at("/restrictions/separateFromDataDeletion", "fjernelse skal være adskilt fra datasletning");
  if (r.requiresReverseDependencyCheck !== true) at("/restrictions/requiresReverseDependencyCheck", "fjernelse skal kræve en reverse-dependency-kontrol");
  if (r.requiresExportOrBackup !== true) at("/restrictions/requiresExportOrBackup", "fjernelse skal kræve eksport eller backup");
  if (r.explicitDestructiveAction !== true) at("/restrictions/explicitDestructiveAction", "datasletning skal kræve en eksplicit destruktiv handling");

  const data = plan.dataDisposition ?? {};
  if (plan.mode === "remove-and-delete-data") {
    if (data.preserve !== false) at("/dataDisposition/preserve", "tilstanden 'remove-and-delete-data' må ikke bevare data");
    if (!data.exportRef && !data.backupRef) at("/dataDisposition/exportRef", "datasletning skal have en eksport eller en verificeret backup");
    if (data.destructiveApproved !== true) at("/dataDisposition/destructiveApproved", "datasletning skal være eksplicit destruktivt godkendt");
    if (!isNamedHuman({ subject: plan.authorization?.humanSubject, name: "Approver", role: "Approver" })) at("/authorization/humanSubject", "datasletning skal godkendes af et navngivent menneske");
    if (!isNamedHuman({ subject: plan.authorization?.secondHumanSubject, name: "Second", role: "Second" })) at("/authorization/secondHumanSubject", "datasletning skal have to-personers-kontrol");
  } else if (plan.mode === "remove-only") {
    if (data.preserve !== true) at("/dataDisposition/preserve", "almindelig afinstallering skal bevare data");
    if (!data.recoveryMetadataRef) at("/dataDisposition/recoveryMetadataRef", "almindelig afinstallering skal bevare recoverymetadata");
    if (data.destructiveApproved === true) at("/dataDisposition/destructiveApproved", "almindelig afinstallering må ikke være destruktiv");
  }
  for (const [i, step] of (plan.steps ?? []).entries()) {
    if (step.mutating === true && step.requiresApproval !== true) at(`/steps/${i}/requiresApproval`, "et muterende trin skal kræve menneskelig godkendelse");
    if (step.kind === "delete-data" && plan.mode !== "remove-and-delete-data") at(`/steps/${i}/kind`, "et slette-trin kræver tilstanden 'remove-and-delete-data'");
  }
  if (plan.metadata?.createdAt && Date.parse(plan.metadata.createdAt) > now + 60000) at("/metadata/createdAt", "planen er dateret i fremtiden");
  return problems;
}
