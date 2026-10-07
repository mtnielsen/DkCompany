/**
 * DKC-002 — semantiske validatorer for arkitektur- og identitetskontrakter.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke alene:
 *
 *   - pilotstandarden: fælles kontrolplan kræver særskilte app-instanser og
 *     databaser pr. kunde; dedicated installation er enterprise-profilen
 *   - identitet: OIDC til mennesker, verificeret workload-identitet til
 *     tjenester, lokalt skygge-ID uden lokale passwords
 *   - ukendte trust roots og tvetydig identitet afvises
 *   - pilotkandidater: eksakt version, dokumenteret gratis/betalt-skel, og
 *     "unknown" er ikke godkendt
 *   - eksplicit driftspris og eksplicitte begrænsninger
 *
 * Validatorerne er rene funktioner og kan kaldes fra CI, tests og installeren.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";

const TEAM_SCHEMES = new Set(["team", "group", "role", "distribution", "alias"]);

/** Et navngivet menneske, ikke et team-alias eller en rolle uden person. */
export function isNamedHuman(owner) {
  if (!owner || typeof owner.subject !== "string") return false;
  const [scheme, ...rest] = owner.subject.split("|");
  const id = rest.join("|").trim();
  if (!id || id.length < 3) return false;
  if (TEAM_SCHEMES.has((scheme ?? "").toLowerCase())) return false;
  if (!owner.name || owner.name.trim().length < 2) return false;
  if (!owner.role || owner.role.trim().length < 2) return false;
  return true;
}

function err(path, message) {
  return { path, message };
}

const has = (arr, value) => Array.isArray(arr) && arr.includes(value);

function schemaErrors(ajv, schemaId, data) {
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

/** Kør skema + semantik for én kontrakt. */
function run(ajv, schemaId, data, rules) {
  const errors = [...schemaErrors(ajv, schemaId, data)];
  if (errors.length === 0) errors.push(...rules(data));
  return { ok: errors.length === 0, errors };
}

/* -------------------------------------------------------------------------- */
/* Deployment profiles                                                        */
/* -------------------------------------------------------------------------- */

export function deploymentProfileProblems(data) {
  const problems = [];
  const owner = data?.metadata?.accountableHuman;
  if (!isNamedHuman(owner)) {
    problems.push(err("/metadata/accountableHuman", "skal være et navngivet menneske med subject på formen 'scheme|person', ikke et team-alias"));
  }

  const tenant = data?.tenantModel ?? {};
  const profile = data?.profileType;

  if (tenant.mode === "shared-control-plane") {
    if (tenant.applicationInstancesPerTenant !== true) {
      problems.push(err("/tenantModel/applicationInstancesPerTenant", "pilotstandarden kræver særskilte app-instanser pr. kunde"));
    }
    if (tenant.databasePerTenant !== true) {
      problems.push(err("/tenantModel/databasePerTenant", "pilotstandarden kræver særskilt database pr. kunde"));
    }
    for (const scope of ["api", "database"]) {
      if (!has(tenant.tenantBoundaryEnforcedAt, scope)) {
        problems.push(err("/tenantModel/tenantBoundaryEnforcedAt", `tenantgrænsen skal håndhæves i '${scope}'`));
      }
    }
    if ((tenant.sharedComponents ?? []).some((c) => /data|database|customer|tenant/i.test(c))) {
      problems.push(err("/tenantModel/sharedComponents", "delte komponenter må ikke omfatte kundedata"));
    }
  }

  if (tenant.mode === "dedicated-installation" && profile !== "dedicated-customer") {
    problems.push(err("/tenantModel/mode", "dedicated installation er enterprise-profilen og kræver profileType 'dedicated-customer'"));
  }

  const ha = data?.highAvailability ?? {};
  if (profile === "single-server") {
    if (ha.enabled === true) {
      problems.push(err("/highAvailability/enabled", "single-server er en ikke-HA profil"));
    }
    if (!(data?.limitations ?? []).some((l) => /(non-ha|nedetid|downtime|single)/i.test(l))) {
      problems.push(err("/limitations", "single-server skal eksplicit nævne nedetid/ikke-HA"));
    }
  }
  if (profile === "multiple-servers") {
    if (ha.enabled !== true) problems.push(err("/highAvailability/enabled", "multiple-servers kræver HA"));
    if (!(Number(ha.failureDomains) >= 2)) problems.push(err("/highAvailability/failureDomains", "HA kræver mindst to uafhængige failure domains"));
    if ((ha.fencing ?? "none") === "none") problems.push(err("/highAvailability/fencing", "HA kræver quorum eller broker-baseret fencing"));
    if (!(ha.measuredFailureTests ?? []).length) problems.push(err("/highAvailability/measuredFailureTests", "HA uden målte fejltest er en påstand"));
  }

  const externalKinds = new Set(["external-application-database", "external-business-source", "backup-destination"]);
  for (const [i, ds] of (data?.dataServices ?? []).entries()) {
    if (externalKinds.has(ds.kind) && !(ds.responsibilityAgreement ?? "").trim()) {
      problems.push(err(`/dataServices/${i}/responsibilityAgreement`, "ekstern tjeneste kræver en ansvarsaftale"));
    }
    if (ds.kind === "backup-destination" && ds.tenantBound !== true) {
      problems.push(err(`/dataServices/${i}/tenantBound`, "backupmål skal være bundet til en tenant"));
    }
  }
  if (profile === "external-data-services" && !(data?.dataServices ?? []).some((d) => externalKinds.has(d.kind))) {
    problems.push(err("/dataServices", "external-data-services kræver mindst én ekstern data-/backup-tjeneste"));
  }

  const host = data?.hostManagement ?? {};
  if (host.enabled === true) {
    if (!(host.broker ?? "").trim()) problems.push(err("/hostManagement/broker", "host-styring kræver et afgrænset broker-lag"));
    if (!(host.allowedOperations ?? []).length) problems.push(err("/hostManagement/allowedOperations", "host-styring kræver en eksplicit whitelist af operationer"));
    if (!(host.outOfBandRecovery ?? "").trim()) problems.push(err("/hostManagement/outOfBandRecovery", "host-styring må ikke fjerne den eneste recoveryvej"));
  }

  const cost = data?.cost ?? {};
  if (!(cost.notes ?? "").trim()) problems.push(err("/cost/notes", "driftsprisen skal være eksplicit"));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Identity trust                                                             */
/* -------------------------------------------------------------------------- */

export function identityTrustProblems(data) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "skal være et navngivet menneske"));
  }

  const roots = data?.trustRoots ?? [];
  const ids = new Set();
  for (const [i, root] of roots.entries()) {
    if (ids.has(root.id)) problems.push(err(`/trustRoots/${i}/id`, `dubleret trust-root id '${root.id}'`));
    ids.add(root.id);
    if (!isNamedHuman(root.owner)) problems.push(err(`/trustRoots/${i}/owner`, "hver trust root skal have en navngivet menneskelig ejer"));
  }

  const issuer = data?.userAuthentication?.issuer;
  const issuerRoot = roots.find((r) => r.type === "oidc-issuer" && r.uri === issuer);
  if (!issuerRoot) {
    problems.push(err("/userAuthentication/issuer", `ukendt OIDC-issuer '${issuer ?? ""}' — ikke i trustRoots`));
  }

  const td = data?.workloadIdentity?.trustDomain;
  const spiffeRoot = roots.find((r) => r.type === "spiffe-trust-domain" && (r.uri === td || (r.uri ?? "").endsWith(td ?? "")));
  if (!spiffeRoot) {
    problems.push(err("/workloadIdentity/trustDomain", `ukendt SPIFFE trust domain '${td ?? ""}' — ikke i trustRoots`));
  }

  const shadow = data?.shadowIdentity ?? {};
  if (shadow.enabled === true) {
    if (shadow.passwordMode !== "none") {
      problems.push(err("/shadowIdentity/passwordMode", "lokalt skygge-ID må ikke have et password; brug passwordMode 'none'"));
    }
    if (!(shadow.upstreams ?? []).length) {
      problems.push(err("/shadowIdentity/upstreams", "skygge-ID kræver mindst én navngivet upstream"));
    }
    if (!(shadow.justification ?? "").trim()) {
      problems.push(err("/shadowIdentity/justification", "skygge-ID skal begrundes"));
    }
    if (!shadow.lifecycle) {
      problems.push(err("/shadowIdentity/lifecycle", "skygge-ID skal have en livscyklus, så det fjernes med den centrale identitet"));
    }
  }

  const binding = data?.tenantBinding ?? {};
  if (binding.claim && binding.claim === data?.userAuthentication?.subjectClaim) {
    problems.push(err("/tenantBinding/claim", "tenant-claim må ikke være identisk med subject-claim; det giver tvetydig tenantbinding"));
  }

  const bg = data?.breakGlass;
  if (bg && bg.audited !== true) {
    problems.push(err("/breakGlass/audited", "nødadgang skal være auditeret"));
  }
  if (bg && !isNamedHuman(bg.owner)) {
    problems.push(err("/breakGlass/owner", "nødadgang skal have en navngivet menneskelig ejer"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Integration candidates                                                     */
/* -------------------------------------------------------------------------- */

const CAPABILITY_FIELDS = ["sso", "scim", "api", "isolation", "export", "backup"];

export function integrationCandidateProblems(data) {
  const problems = [];
  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "skal være et navngivet menneske"));
  }
  if (!isNamedHuman(data?.verification?.verifiedBy)) {
    problems.push(err("/verification/verifiedBy", "verifikation skal udføres af et navngivet menneske"));
  }

  const approved = data?.verification?.status === "approved";
  const unknown = [];
  for (const field of CAPABILITY_FIELDS) {
    if (data?.[field]?.capability === "unknown") unknown.push(field);
  }
  for (const [path, value] of [
    ["/license/type", data?.license?.type],
    ["/hosting/mode", data?.hosting?.mode],
    ["/maintenance/vendorSupport", data?.maintenance?.vendorSupport],
  ]) {
    if (value === "unknown") unknown.push(path);
  }
  if (unknown.length && approved) {
    problems.push(err("/verification/status", `kandidaten kan ikke være 'approved' mens disse er ukendte: ${unknown.join(", ")}`));
  }
  if (data?.backup?.restoreTested === false && approved) {
    problems.push(err("/verification/status", "kandidaten kan ikke være 'approved' uden en testet gendannelse"));
  }

  if (approved) {
    if (data?.sso?.supported !== true) problems.push(err("/sso/supported", "godkendt kandidat skal understøtte SSO"));
    if (!has(data?.sso?.protocols, "oidc")) problems.push(err("/sso/protocols", "godkendt kandidat skal understøtte OIDC"));
    if (data?.api?.documented !== true) problems.push(err("/api/documented", "godkendt kandidat skal have et dokumenteret API"));
    if (data?.export?.apiAccessible !== true && !(data?.export?.manualProcedure ?? "").trim()) {
      problems.push(err("/export/manualProcedure", "godkendt kandidat uden API-eksport skal have en dokumenteret manuel procedure"));
    }
  }

  if (data?.scim?.supported === false && !(data?.scim?.provisioningAlternative ?? "").trim()) {
    problems.push(err("/scim/provisioningAlternative", "når SCIM ikke understøttes, skal en provisioneringsvej dokumenteres"));
  }

  if (data?.hosting?.commercialRedistribution === true && data?.license?.redistributionAllowed !== true) {
    problems.push(err("/hosting/commercialRedistribution", "kommerciel videredistribution kræver at licensen tillader det"));
  }

  const paid = data?.license?.paidFeaturesRequired === true;
  if (paid && !(data?.freeVsPaid?.requiredPaidFeatures ?? []).length) {
    problems.push(err("/freeVsPaid/requiredPaidFeatures", "betalte features skal navngives, ikke antages"));
  }
  if (data?.freeVsPaid?.documented !== true) {
    problems.push(err("/freeVsPaid/documented", "det gratis/betalte funktionsskel skal være dokumenteret"));
  }
  if (!(data?.freeVsPaid?.sourceUrl ?? "").trim()) {
    problems.push(err("/freeVsPaid/sourceUrl", "det gratis/betalte skel skal have en kilde"));
  }

  if (typeof data?.exactVersion === "string" && /(^latest$)|[\^~*]|>=|<=/i.test(data.exactVersion)) {
    problems.push(err("/exactVersion", "kandidaten skal vurderes på en eksakt version, ikke et interval eller 'latest'"));
  }

  const price = data?.price ?? {};
  if (!price.priceBasis && typeof price.listPriceMinor !== "number") {
    problems.push(err("/price", "prisen skal være eksplicit (priceBasis eller listPriceMinor)"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Samlet kørsel over eksempelfiler                                           */
/* -------------------------------------------------------------------------- */

export const ARCHITECTURE_SCHEMAS = {
  deploymentProfile: SCHEMA_IDS.deploymentProfile,
  identityTrust: SCHEMA_IDS.identityTrust,
  integrationCandidate: SCHEMA_IDS.integrationCandidate,
};

const RULES = {
  deploymentProfile: deploymentProfileProblems,
  identityTrust: identityTrustProblems,
  integrationCandidate: integrationCandidateProblems,
};

/**
 * Validér én kontraktstype. `ajv` kan genbruges på tværs af kald.
 */
export function validateArchitecture(kind, data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const schemaId = ARCHITECTURE_SCHEMAS[kind];
  if (!schemaId) throw new Error(`Ukendt arkitektur-kontrakt: ${kind}`);
  return run(instance, schemaId, data, RULES[kind]);
}

/**
 * Find arkitektureksempler i en mappe og validér dem. Returnerer en liste af
 * `{ file, ok, errors }`. Filnavne bestemmer kontraktstypen:
 *   deployment-profile.*  → deploymentProfile
 *   identity-trust.*      → identityTrust
 *   integration-candidate.* → integrationCandidate
 */
export function validateArchitectureDir(dir) {
  const ajv = buildAjv().ajv;
  const results = [];
  if (!dir) return results;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const kind = file.startsWith("deployment-profile.")
      ? "deploymentProfile"
      : file.startsWith("identity-trust.")
        ? "identityTrust"
        : file.startsWith("integration-candidate.")
          ? "integrationCandidate"
          : null;
    if (!kind) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validateArchitecture(kind, data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}
