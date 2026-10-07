/**
 * DKC-059 — versionsforhandling, kompatibilitetsklassificering og preflight.
 *
 * Et providerskift må ikke afgøres af en forbindelsesstreng. Selv en identisk
 * streng eller et fælles SQL-dialekt er kun en påstand; afgørelsen kommer fra
 * capability-forhandlingen og den eksplicitte kompatibilitetsrække:
 *
 *   - `negotiateCapabilities` kræver alle obligatoriske capabilities i målet og
 *     afviser enhver nedgradering af en sikkerhedskritisk capability (niveau
 *     eller version), og
 *   - `preflightSwap` klassificerer skiftet drop-in / planlagt migration /
 *     ikke-understøttet og stopper det **før** nogen ændring hvis en
 *     obligatorisk capability mangler eller en sikkerhedssemantik nedgraderes.
 */
import { compareVersions, parseVersion } from "../../adapter-sdk/src/version.mjs";
import { capabilityById, capabilitiesForClass, levelRank, providerById } from "./provider-model.mjs";

function problem(code, message, details = {}) {
  return { code, message, ...details };
}

/**
 * Forhandl capabilities mellem en kilde- og målprovider.
 *
 * @returns {{status: "supported"|"degraded"|"unsupported", problems: object[],
 *            capabilities: object[], degradations: object[], connectionIgnored: boolean}}
 */
export function negotiateCapabilities({ source, target, catalog, policy } = {}) {
  const problems = [];
  const capabilities = [];
  const degradations = [];
  if (!source || !target) {
    return { status: "unsupported", problems: [problem("unknown_provider", "kilde- eller målprovideren findes ikke")], capabilities, degradations };
  }
  if (source.class !== target.class) {
    problems.push(problem("class_mismatch", `providerne tilhører forskellige klasser ('${source.class}' og '${target.class}')`));
  }

  const known = new Set((catalog?.capabilities ?? []).map((c) => c.id));
  if (policy?.negotiation?.unknownCapabilityDenied !== false) {
    for (const provider of [source, target]) {
      for (const capId of Object.keys(provider.capabilities ?? {})) {
        if (!known.has(capId)) {
          problems.push(problem("unknown_capability", `provideren '${provider.id}' erklærer den ukendte capability '${capId}'`, { capability: capId }));
        }
      }
    }
  }

  for (const cap of capabilitiesForClass(catalog, source.class)) {
    const from = source.capabilities?.[cap.id] ?? null;
    const to = target.capabilities?.[cap.id] ?? null;
    capabilities.push({ id: cap.id, mandatory: cap.mandatory, securityCritical: cap.securityCritical, source: from, target: to });

    if (to && cap.minVersion) {
      const parsed = parseVersion(to.version);
      if (!parsed) {
        problems.push(problem("capability_version_invalid", `målets capability '${cap.id}' har en ugyldig version '${to.version}'`, { capability: cap.id }));
      } else if (compareVersions(to.version, cap.minVersion) < 0) {
        problems.push(problem("capability_below_min_version", `målets capability '${cap.id}' er version ${to.version}, men kræver mindst ${cap.minVersion}`, { capability: cap.id }));
      }
    }

    if (cap.mandatory && !to) {
      problems.push(problem("missing_mandatory_capability", `målet '${target.id}' mangler den obligatoriske capability '${cap.id}'`, { capability: cap.id }));
      continue;
    }

    if (from && cap.securityCritical) {
      // Sikkerhedskritiske semantikker må ikke nedgraderes til laveste fællesnævner.
      if (!to) {
        problems.push(problem("security_capability_missing", `målet '${target.id}' mangler den sikkerhedskritiske capability '${cap.id}', som kilden '${source.id}' havde`, { capability: cap.id }));
      } else if (levelRank(to.level) < levelRank(from.level)) {
        problems.push(
          problem("security_downgrade_level", `capability'en '${cap.id}' nedgraderes fra '${from.level}' til '${to.level}'`, { capability: cap.id, from: from.level, to: to.level }),
        );
      } else if (source.product === target.product && parseVersion(to.version) && parseVersion(from.version) && compareVersions(to.version, from.version) < 0) {
        // Versionssammenligning giver kun mening inden for samme produkt; på
        // tværs af produkter er niveauet og minimumsversionen afgørende.
        problems.push(
          problem("security_downgrade_version", `capability'en '${cap.id}' nedgraderes fra version ${from.version} til ${to.version}`, { capability: cap.id, from: from.version, to: to.version }),
        );
      }
    } else if (from && !to) {
      degradations.push({ capability: cap.id, from, reason: "valgfri capability findes ikke i målet" });
    }
  }

  let status = "supported";
  if (problems.length) status = "unsupported";
  else if (degradations.length && policy?.negotiation?.allowDegradedOptional !== true) status = "degraded";

  return {
    status,
    problems,
    capabilities,
    degradations,
    connectionIgnored: policy?.negotiation?.connectionStringNeverBypassesGate === true,
  };
}

/** Find den eksplicitte kompatibilitetsrække for et skift. */
export function classifySwitch({ source, target, matrix } = {}) {
  if (!source || !target) return { mode: "unsupported", row: null, problems: [problem("unknown_provider", "kilde- eller målprovideren findes ikke")] };
  const row = (matrix?.rows ?? []).find((r) => r.class === source.class && r.from === source.id && r.to === target.id) ?? null;
  if (!row) {
    return { mode: "unsupported", row: null, problems: [problem("no_compatibility_row", `der findes ingen kompatibilitetsrække for '${source.id}' -> '${target.id}'; et skift må ikke antages`) ] };
  }
  return { mode: row.mode, row, problems: [] };
}

/**
 * Kør preflight for et providerskift. Returnerer en afgørelse der kan bruges
 * som bevis før cutover. `connectionString` indgår kun som oplysning — den
 * ændrer aldrig afgørelsen.
 */
export function preflightSwap({ providers, catalog, matrix, policy, from, to, connectionString = null } = {}) {
  const source = providerById(providers, from);
  const target = providerById(providers, to);
  const problems = [];
  if (!source) problems.push(problem("unknown_provider", `kilde-provideren '${from}' findes ikke`));
  if (!target) problems.push(problem("unknown_provider", `mål-provideren '${to}' findes ikke`));

  let classification = { mode: "unsupported", row: null, problems: [] };
  let negotiation = { status: "unsupported", problems: [], capabilities: [], degradations: [], connectionIgnored: true };
  if (source && target) {
    classification = classifySwitch({ source, target, matrix });
    problems.push(...classification.problems);
    negotiation = negotiateCapabilities({ source, target, catalog, policy });
    for (const p of negotiation.problems) {
      if (!problems.some((existing) => existing.code === p.code && existing.capability === p.capability)) problems.push(p);
    }
  }

  if (classification.row?.mode === "unsupported") {
    problems.push(problem("unsupported_switch", `skiftet '${from}' -> '${to}' er ikke understøttet: ${classification.row.reason}`));
  }
  if (negotiation.status === "degraded" && policy?.negotiation?.allowDegradedOptional !== true) {
    problems.push(problem("degraded_not_allowed", "skiftet ville nedgradere en valgfri capability, men politikken tillader det ikke"));
  }

  const connectionMatches = Boolean(source?.connection && target?.connection && source.connection.scheme === target.connection.scheme && source.connection.endpoint === target.connection.endpoint);
  const allowed = problems.length === 0 && classification.mode !== "unsupported" && negotiation.status === "supported";

  const row = classification.row;
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ProviderPreflight",
    from,
    to,
    class: source?.class ?? target?.class ?? null,
    mode: classification.mode,
    status: negotiation.status,
    allowed,
    connectionString: connectionString ?? null,
    connectionStringMatches: connectionMatches,
    connectionStringNeverBypassesGate: policy?.negotiation?.connectionStringNeverBypassesGate === true,
    negotiation,
    problems,
    requiredMappings: {
      data: row?.requiresDataMigration ?? false,
      ids: row?.requiresIdMapping ?? false,
      acl: row?.requiresAclMapping ?? false,
      migrationProof: row?.requiresMigrationProof ?? false,
    },
    cutover: {
      requiresHumanApproval: row?.requiresHumanApproval ?? false,
      requiresRollback: row?.requiresRollback ?? false,
      oldProviderReadOnly: row?.oldProviderReadOnly ?? false,
      revokeCredentials: row?.revokeCredentials ?? false,
    },
  };
}
