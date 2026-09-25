/**
 * DKC-023 — semantiske validatorer for releaseprofiler.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger skemaet
 * ikke kan udtrykke:
 *
 *   - en kandidat kan ikke være godkendt med manglende obligatorisk SSO eller
 *     uafklaret licens,
 *   - en `approved`-gate kræver en navngivet menneskelig godkendelse,
 *   - native upstream-admin-endpoints må ikke være eksponeret uden om adapteren,
 *   - hvert verbum skal have et ærligt conformance-niveau med en begrundelse,
 *   - releaseprofilen må ikke love stærkere conformance end modulmanifestet,
 *   - den eksakte version skal matche en forhandlet versionsserie.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { VERB_GROUPS } from "./manifest.mjs";
import { isNamedHuman } from "./architecture.mjs";
import { satisfiesRange, compareVersions, parseVersion } from "../../adapter-sdk/src/version.mjs";

const PLACEHOLDER = /^(n\/?a|todo|tbd|unknown|ved ikke|\.+|-+)$/i;
const RANK = { full: 2, partial: 1, unsupported: 0 };

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

function reasonProblem(path, block) {
  if (block?.conformance === "full") return null;
  const reason = (block?.reason ?? "").trim();
  if (reason.length < 20) return err(path, `begrundelse er for kort (${reason.length} tegn)`);
  if (PLACEHOLDER.test(reason)) return err(path, `begrundelse er en placeholder ('${reason}')`);
  return null;
}

/**
 * @param {object} data         Releaseprofil.
 * @param {object} [opts]
 * @param {object} [opts.candidate] IntegrationCandidate, hvis den kan findes.
 * @param {object} [opts.manifest]  Modulmanifestet profilen hører til.
 */
export function adapterReleaseProfileProblems(data, { candidate = null, manifest = null } = {}) {
  const problems = [];

  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "skal være et navngivet menneske med subject på formen 'scheme|person'"));
  }
  if (!isNamedHuman(data?.verification?.verifiedBy)) {
    problems.push(err("/verification/verifiedBy", "verifikation skal udføres af et navngivet menneske"));
  }

  // 1) Verbummer: ærlig begrundelse + ingen overerklæring ift. manifestet.
  const matrices = [
    ["/verbMatrix", data?.verbMatrix, manifest?.verbs, VERB_GROUPS.ops],
    ["/privacyMatrix", data?.privacyMatrix, manifest?.privacy, VERB_GROUPS.privacy],
  ];
  for (const [base, matrix, manifestGroup, verbs] of matrices) {
    for (const verb of verbs) {
      const block = matrix?.[verb];
      if (!block) {
        problems.push(err(`${base}/${verb}`, "verbum mangler i releaseprofilen"));
        continue;
      }
      const reason = reasonProblem(`${base}/${verb}`, block);
      if (reason) problems.push(reason);
      if (block.conformance === "full" && !block.endpoint) {
        problems.push(err(`${base}/${verb}`, "full kræver et endpoint"));
      }
      if (manifestGroup && manifestGroup[verb]) {
        const manifestRank = RANK[manifestGroup[verb].conformance] ?? 0;
        const profileRank = RANK[block.conformance] ?? 0;
        if (profileRank > manifestRank) {
          problems.push(err(`${base}/${verb}`, `releaseprofilen lover '${block.conformance}', men modulet erklærer '${manifestGroup[verb].conformance}'`));
        }
      }
    }
  }

  // 2) Versionsforhandling: eksakt version skal matche en understøttet serie.
  const ranges = data?.negotiation?.supportedRanges ?? [];
  const exact = data?.upstream?.exactVersion;
  if (exact && ranges.length && !ranges.some((range) => satisfiesRange(exact, range))) {
    problems.push(err("/negotiation/supportedRanges", `den eksakte version '${exact}' matcher ingen af serierne (${ranges.join(", ")})`));
  }
  const parsed = parseVersion(exact);
  if (!parsed) problems.push(err("/upstream/exactVersion", `'${exact ?? ""}' er ikke en eksakt version`));

  // 3) Native admin må ikke være eksponeret.
  if (data?.nativeAdmin?.exposed === true) {
    problems.push(err("/nativeAdmin/exposed", "native upstream-admin-endpoints må ikke eksponeres direkte; de skal gå gennem adapteren og PDP'en"));
  }
  if (!(data?.nativeAdmin?.protectedBy ?? []).includes("adapter")) {
    problems.push(err("/nativeAdmin/protectedBy", "adapteren skal være en af beskytterne"));
  }

  // 4) Den hårde godkendelsesgate.
  const gate = data?.approvalGate ?? {};
  const blockers = [];
  if (gate.requiredSso !== false) {
    if (candidate ? candidate.sso?.supported !== true : false) blockers.push("manglende obligatorisk SSO");
  }
  if (candidate && (!candidate.license || candidate.license.type === "unknown" || !candidate.license.spdx)) {
    blockers.push("uafklaret licens");
  }
  if (gate.licenseType === "unknown") blockers.push("uafklaret licens");
  if (data?.verification?.status !== "approved") blockers.push("kandidaten er ikke godkendt af et navngivet menneske");

  if (gate.status === "approved") {
    if ((gate.blockers ?? []).length) problems.push(err("/approvalGate/blockers", "en godkendt gate må ikke have blockers"));
    if (blockers.length) problems.push(err("/approvalGate/status", `kan ikke være 'approved': ${blockers.join(", ")}`));
  } else if (!(gate.blockers ?? []).length) {
    problems.push(err("/approvalGate/blockers", "en blokeret gate skal navngive mindst ét konkret blocker"));
  }
  if (gate.status === "blocked" && data?.verification?.status === "approved" && (gate.blockers ?? []).length) {
    // Det er tilladt at have en menneskeligt godkendt kandidat, men gaten skal
    // stadig blokere. Ingen fejl — blot konsistenskravet ovenfor.
  }

  // 5) Kandidatkrydsreference.
  if (candidate) {
    if (candidate.exactVersion && candidate.exactVersion !== exact) {
      problems.push(err("/upstream/exactVersion", `matcher ikke kandidatens version '${candidate.exactVersion}'`));
    }
    const candidateEdition = candidate.edition?.name ?? null;
    if (candidateEdition && data?.upstream?.edition && candidateEdition !== data.upstream.edition) {
      problems.push(err("/upstream/edition", `matcher ikke kandidatens edition '${candidateEdition}'`));
    }
  }

  return problems;
}

export function validateAdapterReleaseProfile(data, ajv, opts = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.upstreamReleaseProfile, data)];
  if (errors.length === 0) errors.push(...adapterReleaseProfileProblems(data, opts));
  return { ok: errors.length === 0, errors };
}

/**
 * Læs alle `upstream-release-profile.*.example.json` fra en mappe og validér
 * dem. Kandidaten findes ved siden af med samme suffiks.
 */
export function validateAdapterReleaseProfileDir(dir, { manifestDir = null } = {}) {
  const ajv = buildAjv().ajv;
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const files = readdirSync(dir).filter((f) => f.startsWith("upstream-release-profile.") && f.endsWith(".example.json")).sort();
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, candidate: null, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const suffix = file.replace(/^upstream-release-profile\./, "").replace(/\.example\.json$/, "");
    const candidateFile = `integration-candidate.${suffix}.example.json`;
    let candidate = null;
    if (existsSync(join(dir, candidateFile))) {
      try {
        candidate = JSON.parse(readFileSync(join(dir, candidateFile), "utf8"));
      } catch {
        candidate = null;
      }
    }
    let manifest = null;
    if (manifestDir && candidate?.metadata?.name) {
      const manifestPath = join(manifestDir, candidate.metadata.name, "module-manifest.json");
      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        } catch {
          manifest = null;
        }
      }
    }
    const { ok, errors } = validateAdapterReleaseProfile(data, ajv, { candidate, manifest });
    results.push({ file, ok, candidate, errors });
  }
  return results;
}

export { compareVersions };
