/**
 * DKC-014 — semantiske validatorer for forsyningskæden.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et
 * skema ikke kan udtrykke alene:
 *
 *   - en digest der er syntetisk (samme tegn, sekventiel eller kendt
 *     pladsholder) er ikke en digest, uanset at den er 64 hex-tegn,
 *   - et artefakt må ikke stå som bygget/signeret uden en digest og en
 *     signatur der peger på en betroet nøgle,
 *   - et ikke-bygget artefakt skal bære en ærlig begrundelse,
 *   - en SBOM må ikke indeholde `latest` eller pladsholder-hashes,
 *   - branch protection skal kræve CODEOWNERS, DCO-sign-off og kendte
 *     statuskontroller, og må ikke påstå kryptografisk commitsignering.
 */
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const ASC = "0123456789abcdef";
const DESC = [...ASC].reverse().join("");

function err(path, message) {
  return { path, message };
}

/**
 * Afgør om en hex-streng er en pladsholder frem for et rigtigt indholdsdigest.
 * En gyldig længde er ikke nok: `aaaa…`, `0123…` og `deadbeef…` er alle
 * 64 hex-tegn, men de kan ikke være output af en hashfunktion over et vilkårligt
 * artefakt. Returnerer true for både ugyldige og syntetiske værdier.
 */
export function isPlaceholderHex(value) {
  if (typeof value !== "string") return true;
  if (!SHA256.test(value) && !SHA512.test(value)) return true;
  const chars = [...value];
  if (new Set(chars).size === 1) return true;
  for (let i = 0; i + 8 <= value.length; i++) {
    const slice = value.slice(i, i + 8);
    if (ASC.includes(slice) || DESC.includes(slice)) return true;
  }
  if (/^(deadbeef|cafebabe|feedface|012345|123456)/.test(value)) return true;
  return false;
}

export function isPlaceholderSha256(value) {
  return !SHA256.test(value ?? "") || isPlaceholderHex(value);
}

function uniqueBy(items, key, at, problems, label) {
  const seen = new Set();
  for (const [i, item] of items.entries()) {
    const id = item?.[key];
    if (seen.has(id)) problems.push(err(at(i), `dubleret ${label} '${id}'`));
    seen.add(id);
  }
}

/* -------------------------------------------------------------------------- */
/* SBOM                                                                       */
/* -------------------------------------------------------------------------- */

export function sbomProblems(data) {
  const problems = [];
  const refs = new Set();
  for (const [i, c] of (data?.components ?? []).entries()) {
    const at = (suffix) => `/components/${i}${suffix}`;
    const ref = c["bom-ref"];
    if (refs.has(ref)) problems.push(err(at("/bom-ref"), `dubleret bom-ref '${ref}'`));
    refs.add(ref);
    if (c.version === "latest" || c.version === "*") {
      problems.push(err(at("/version"), `komponenten '${c.name}' er ikke versionslåst (${c.version})`));
    }
    if ((c.purl ?? "") !== "" && !c.purl.startsWith("pkg:")) {
      problems.push(err(at("/purl"), `komponenten '${c.name}' har en ugyldig purl`));
    }
    for (const [h, hash] of (c.hashes ?? []).entries()) {
      if (isPlaceholderHex(hash.content)) {
        problems.push(err(at(`/hashes/${h}/content`), `komponenten '${c.name}' har en pladsholder-hash`));
      }
      const expected = hash.alg === "SHA-256" ? SHA256 : SHA512;
      if (!expected.test(hash.content ?? "")) {
        problems.push(err(at(`/hashes/${h}/content`), `hash-længden matcher ikke ${hash.alg}`));
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Build provenance                                                           */
/* -------------------------------------------------------------------------- */

export function buildProvenanceProblems(data) {
  const problems = [];
  for (const [i, s] of (data?.subject ?? []).entries()) {
    if (isPlaceholderSha256(s?.digest?.sha256)) {
      problems.push(err(`/subject/${i}/digest/sha256`, "proveniens-subjektet har en pladsholder-digest"));
    }
  }
  const started = Date.parse(data?.predicate?.runDetails?.metadata?.startedOn);
  const finished = Date.parse(data?.predicate?.runDetails?.metadata?.finishedOn);
  if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) {
    problems.push(err("/predicate/runDetails/metadata", "byggeriets sluttid ligger før starttiden"));
  }
  if ((data?.predicate?.buildDefinition?.resolvedDependencies ?? []).length === 0) {
    problems.push(err("/predicate/buildDefinition/resolvedDependencies", "proveniensen mangler kildeafhængigheder"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Artifact manifest                                                          */
/* -------------------------------------------------------------------------- */

export function artifactManifestProblems(data) {
  const problems = [];
  const names = new Set();
  const keyIds = new Set();
  for (const [i, key] of (data?.trustAnchor?.keys ?? []).entries()) {
    if (keyIds.has(key.keyId)) problems.push(err(`/trustAnchor/keys/${i}/keyId`, `dubleret nøgle-id '${key.keyId}'`));
    keyIds.add(key.keyId);
    if (!isNamedHuman(key.owner)) problems.push(err(`/trustAnchor/keys/${i}/owner`, "en betroet nøgle skal have et navngivet menneske som ejer"));
  }
  for (const [i, a] of (data?.artifacts ?? []).entries()) {
    const at = (suffix) => `/artifacts/${i}${suffix}`;
    if (names.has(a.name)) problems.push(err(at("/name"), `dubleret artefaktnavn '${a.name}'`));
    names.add(a.name);

    if (a.status === "not-built") {
      if (!(a.reason ?? "").trim()) problems.push(err(at("/reason"), `det ikke-byggede artefakt '${a.name}' mangler en begrundelse`));
      if (a.digest !== null || a.signature !== null) problems.push(err(at("/digest"), `det ikke-byggede artefakt '${a.name}' må ikke bære digest eller signatur`));
      continue;
    }

    if (a.digest === null || !SHA256.test(a.digest ?? "")) problems.push(err(at("/digest"), `artefaktet '${a.name}' er '${a.status}' men mangler en 64-hex digest`));
    else if (isPlaceholderSha256(a.digest)) problems.push(err(at("/digest"), `artefaktet '${a.name}' har en pladsholder-digest`));

    if (a.status === "signed") {
      if (a.signature === null) problems.push(err(at("/signature"), `artefaktet '${a.name}' er signeret men mangler en signatur`));
    } else if (a.status === "built-unsigned") {
      if (!(a.reason ?? "").trim()) problems.push(err(at("/reason"), `det usignerede artefakt '${a.name}' mangler en begrundelse`));
      if (a.signature !== null) problems.push(err(at("/signature"), `artefaktet '${a.name}' står som usigneret men bærer en signatur`));
    }

    if (a.signature && !keyIds.has(a.signature.keyId)) {
      problems.push(err(at("/signature/keyId"), `artefaktet '${a.name}' er signeret med en ukendt nøgle '${a.signature.keyId}'`));
    }
    for (const refName of ["sbom", "provenance"]) {
      const ref = a[refName];
      if (ref && isPlaceholderSha256(ref.sha256)) problems.push(err(at(`/${refName}/sha256`), `artefaktet '${a.name}' har en pladsholder-digest i ${refName}`));
    }
    if (a.type === "container-image" && !(a.repository ?? "").trim()) {
      problems.push(err(at("/repository"), `containerartefaktet '${a.name}' mangler et repository`));
    }
  }
  if (data?.sourceCommit && (data.artifacts ?? []).some((a) => a.sourceCommit !== data.sourceCommit)) {
    problems.push(err("/artifacts", "alle artefakter skal være bundet til manifestets kilde-commit"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Branch protection                                                          */
/* -------------------------------------------------------------------------- */

const REQUIRED_PROTECTED = ["contracts/", "policy/", "security/", ".github/", "release/"];

export function branchProtectionProblems(data, { checkIds = new Set() } = {}) {
  const problems = [];
  const paths = new Set(data?.protectedPaths ?? []);
  for (const required of REQUIRED_PROTECTED) {
    if (![...paths].some((p) => p === required || p.startsWith(required.replace(/\/$/, "")))) {
      problems.push(err("/protectedPaths", `den beskyttede sti '${required}' mangler`));
    }
  }
  for (const [i, p] of (data?.policies ?? []).entries()) {
    const at = (suffix) => `/policies/${i}${suffix}`;
    if (p.requiredStatusChecks.includes("release-check") === false) {
      problems.push(err(at("/requiredStatusChecks"), "release-gate-kontrollen skal være obligatorisk"));
    }
    if (!p.requireDcoSignoff) problems.push(err(at("/requireDcoSignoff"), "DCO-sign-off skal bevares"));
    if (p.requireSignedCommits || p.cryptoSigningClaimed) {
      problems.push(err(at("/requireSignedCommits"), "DCO-sign-off er ikke kryptografisk commitsignering og må ikke beskrives som det"));
    }
    for (const [c, id] of p.requiredStatusChecks.entries()) {
      if (checkIds.size > 0 && !checkIds.has(id)) {
        problems.push(err(at(`/requiredStatusChecks/${c}`), `den obligatoriske statuskontrol '${id}' findes ikke i baseline-registeret`));
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Wrappers                                                                   */
/* -------------------------------------------------------------------------- */

export function validateSbom(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.sbom, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...sbomProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateBuildProvenance(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.buildProvenance, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...buildProvenanceProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateArtifactManifest(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.artifactManifest, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...artifactManifestProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateBranchProtection(data, ajv, opts) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.branchProtection, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...branchProtectionProblems(data, opts));
  return { ok: result.length === 0, errors: result };
}
