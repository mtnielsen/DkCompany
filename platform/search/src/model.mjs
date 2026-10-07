/**
 * DKC-028 — semantik for rettighedsbevidst videnssøgning.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - en videnskilde er read-only, tenantbundet og bruger en secretreference,
 *   - et dokument bærer tenant, klassifikation og kilde-ACL,
 *   - søgning filtrerer på tenant og ACL **før** scoring, og en hemmelig/
 *     fortrolig side kan ikke nå svar, snippets, embeddings eller citationsliste,
 *   - adgang revalideres ved læsning, så en tilbagekaldt rettighed også rammer
 *     allerede indekseret indhold,
 *   - en rettighedsændring eller sletning invaliderer indeks og cache, og
 *   - et svar bærer kildehenvisning og usikkerhed, mens hentet indhold er
 *     ubetroet data der aldrig må aktivere et privilegeret værktøj.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const SOURCES_PATH = "search/sources.json";
export const POLICY_PATH = "search/index-policy.json";
export const CORPUS_PATH = "search/corpus/bookstack-pages.json";
export const INDEX_DIR = "search/index";
export const REPORT_PATH = "search/report/knowledge-search-report.json";
export const REPORT_DOC_PATH = "docs/search/knowledge-search-report.md";

export const CLASSIFICATIONS = ["public", "internal", "personal", "special-category", "confidential"];
export const CLASSIFICATION_RANK = { public: 0, internal: 1, personal: 2, "special-category": 3, confidential: 4 };
export const DENIED_REASON = "default-deny";

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadSources(root) {
  return readJson(root, SOURCES_PATH);
}
export function loadPolicy(root) {
  return readJson(root, POLICY_PATH);
}
export function loadCorpus(root) {
  return readJson(root, CORPUS_PATH);
}
export function loadAll(root) {
  return { sources: loadSources(root), policy: loadPolicy(root), corpus: loadCorpus(root) };
}

export function classificationRank(classification) {
  return CLASSIFICATION_RANK[classification] ?? 99;
}

/** Klarering for en principal; aldrig højere end principalens eksplicitte klarering. */
export function principalClearance(principal) {
  return principal?.clearance ?? "internal";
}

/* -------------------------------------------------------------------------- */
/* Videnskilde                                                                */
/* -------------------------------------------------------------------------- */

export function knowledgeSourceProblems(data, { supportedTenants = null } = {}) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "videnskildekontrakten er ikke et objekt")];
  if (!isNamedHuman(data.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "videnskilden skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  for (const [i, source] of (data.sources ?? []).entries()) {
    const at = `/sources/${i}`;
    if (ids.has(source.id)) problems.push(err(`${at}/id`, `kilden '${source.id}' er erklæret flere gange`));
    ids.add(source.id);
    if (source.readOnly !== true) problems.push(err(`${at}/readOnly`, `kilden '${source.id}' skal være read-only`));
    if (source.aclMode !== "source") problems.push(err(`${at}/aclMode`, `kilden '${source.id}' skal hente ACL fra kilden`));
    if (!/^(vault|k8s|env|file|kms):/.test(source.secretRef ?? "")) {
      problems.push(err(`${at}/secretRef`, `kilden '${source.id}' skal bruge en secretreference, ikke en rå hemmelighed`));
    }
    if (!CLASSIFICATIONS.includes(source.classificationDefault)) {
      problems.push(err(`${at}/classificationDefault`, `kilden '${source.id}' mangler en gyldig standardklassifikation`));
    }
    if (supportedTenants && !supportedTenants.has(source.tenantId)) {
      problems.push(err(`${at}/tenantId`, `kilden '${source.id}' peger på den ukendte tenant '${source.tenantId}'`));
    }
    if ((source.sync?.fullEveryMinutes ?? 0) < (source.sync?.incrementalMinutes ?? 0)) {
      problems.push(err(`${at}/sync`, `kilden '${source.id}' har en inkrementel synkronisering der er langsommere end den fulde`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Indekspolitik                                                              */
/* -------------------------------------------------------------------------- */

export function searchIndexPolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "indekspolitikken er ikke et objekt")];
  if (!isNamedHuman(policy.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "indekspolitikken skal have et navngivet menneske som ejer"));
  }
  const acl = policy.acl ?? {};
  if (acl.defaultDeny !== true) problems.push(err("/acl/defaultDeny", "adgang skal være default-deny"));
  if (acl.tenantBeforeScoring !== true) problems.push(err("/acl/tenantBeforeScoring", "tenant skal filtreres før scoring"));
  if (acl.aclBeforeScoring !== true) problems.push(err("/acl/aclBeforeScoring", "ACL skal filtreres før scoring"));
  if (acl.revalidateAtRead !== true) problems.push(err("/acl/revalidateAtRead", "adgang skal revalideres ved læsning"));
  const retrieval = policy.retrieval ?? {};
  if (!(retrieval.maxResults >= 1)) problems.push(err("/retrieval/maxResults", "maksimalt antal resultater skal være positivt"));
  if (!(retrieval.minScore >= 0)) problems.push(err("/retrieval/minScore", "minimumsscoren skal være ikke-negativ"));
  if (retrieval.combine !== "lexical-and-embedding") problems.push(err("/retrieval/combine", "søgningen skal kombinere leksikalsk og embedding-scoring"));
  const cache = policy.cache ?? {};
  if (!(cache.ttlSeconds >= 1)) problems.push(err("/cache/ttlSeconds", "cache-TTL skal være positiv"));
  if (cache.invalidateOnPermissionChange !== true) problems.push(err("/cache/invalidateOnPermissionChange", "cachen skal invalideres ved rettighedsændring"));
  if (cache.invalidateOnDelete !== true) problems.push(err("/cache/invalidateOnDelete", "cachen skal invalideres ved sletning"));
  const deletion = policy.deletion ?? {};
  if (!(deletion.deadlineSeconds >= 1)) problems.push(err("/deletion/deadlineSeconds", "slettefristen skal være positiv"));
  if (deletion.measured !== false) problems.push(err("/deletion/measured", "en modelfrist må ikke erklæres som en målt frist"));
  if (deletion.requiresLiveSource !== true) problems.push(err("/deletion/requiresLiveSource", "en målt frist kræver en levende kilde"));
  const answer = policy.answer ?? {};
  if (answer.treatContentAsUntrusted !== true) problems.push(err("/answer/treatContentAsUntrusted", "hentet indhold skal behandles som ubetroet"));
  if (answer.toolActivationFromContent !== "denied") problems.push(err("/answer/toolActivationFromContent", "indhold må ikke kunne aktivere værktøjer"));
  if (answer.requireCitation !== true) problems.push(err("/answer/requireCitation", "et svar skal have kildehenvisning"));
  if (answer.uncertaintyRequired !== true) problems.push(err("/answer/uncertaintyRequired", "et svar skal bære usikkerhed"));
  if (answer.onInjection !== "flag-and-neutralize") problems.push(err("/answer/onInjection", "injektion skal markeres og neutraliseres"));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Dokument                                                                   */
/* -------------------------------------------------------------------------- */

export function knowledgeDocumentProblems(doc, { source = null } = {}) {
  const problems = [];
  if (!doc || typeof doc !== "object") return [err("/", "dokumentet er ikke et objekt")];
  if (source && doc.sourceId !== source.id) problems.push(err("/sourceId", `dokumentet '${doc.id}' tilhører ikke kilden '${source.id}'`));
  if (source && doc.tenantId !== source.tenantId) problems.push(err("/tenantId", `dokumentet '${doc.id}' har en anden tenant end kilden`));
  if (!doc.id.startsWith(`${doc.sourceId}:`)) problems.push(err("/id", `dokumentets id '${doc.id}' skal starte med kilde-id'et`));
  if (!/^[a-f0-9]{64}$/.test(doc.contentSha256 ?? "")) problems.push(err("/contentSha256", `dokumentet '${doc.id}' mangler et gyldigt indholdsdigest`));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Svar                                                                       */
/* -------------------------------------------------------------------------- */

export function retrievalAnswerProblems(answer) {
  const problems = [];
  if (!answer || typeof answer !== "object") return [err("/", "svaret er ikke et objekt")];
  if (answer.untrusted !== true || answer.executable !== false) {
    problems.push(err("/untrusted", "svarindhold skal være ubetroet og ikke-eksekverbart"));
  }
  if (answer.toolActivationDenied !== true || (answer.toolProposals ?? []).length > 0) {
    problems.push(err("/toolProposals", "indhold fra en artikel må aldrig aktivere et værktøj"));
  }
  if ((answer.citations ?? []).length === 0) problems.push(err("/citations", "et svar skal have mindst én kildehenvisning"));
  const uncertainty = answer.uncertainty ?? {};
  if (!["low", "medium", "high"].includes(uncertainty.level)) problems.push(err("/uncertainty/level", "usikkerhedsniveauet er ugyldigt"));
  if (!(typeof uncertainty.score === "number" && uncertainty.score >= 0 && uncertainty.score <= 1)) {
    problems.push(err("/uncertainty/score", "usikkerhedsscoren skal ligge mellem 0 og 1"));
  }
  if ((uncertainty.reason ?? "").trim().length < 10) problems.push(err("/uncertainty/reason", "usikkerheden skal begrundes"));
  for (const [i, citation] of (answer.citations ?? []).entries()) {
    if (!citation.documentId || !citation.title) problems.push(err(`/citations/${i}`, "citatet mangler dokument-id eller titel"));
  }
  return problems;
}
