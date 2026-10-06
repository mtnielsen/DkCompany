/**
 * DKC-028 — tenant- og ACL-bevidst retrieval.
 *
 * Rækkefølgen er det afgørende: principalens tenant udledes først, derefter
 * filtreres dokumenter på tenant og kilde-ACL, og **kun** de autoriserede
 * dokumenter scores (leksikalsk og som embedding). En privat HR-side kan derfor
 * hverken nå svaret, snippets, embedding-søgningen eller citationslisten.
 * Adgang revalideres ved læsning gennem en `aclResolver`, så en tilbagekaldt
 * rettighed også rammer allerede indekseret indhold.
 */
import { filterAuthorized, normalizePrincipal } from "./permissions.mjs";
import { digestOf } from "../../runtime/src/digest.mjs";

const STOPWORDS = new Set(["og", "i", "at", "en", "et", "den", "det", "er", "som", "til", "på", "af", "for", "med", "the", "a", "an", "of", "to", "and", "is", "are"]);

export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9æøåäöüß]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Deterministisk embedding: hash hvert token ind i et fast antal dimensioner. */
export function embeddingVector(text, dims = 256) {
  const vector = new Array(dims).fill(0);
  for (const token of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vector[idx] += 1;
  }
  return vector;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Leksikalsk score: andel af forespørgselstokens der findes i dokumentet. */
export function lexicalScore(queryTokens, docTokens) {
  if (queryTokens.length === 0) return 0;
  const set = new Set(docTokens);
  let hits = 0;
  for (const token of queryTokens) if (set.has(token)) hits += 1;
  return hits / queryTokens.length;
}

export function scoreDocument({ query, queryVector, document, policy }) {
  const docTokens = tokenize(`${document.title} ${document.content}`);
  const lexical = lexicalScore(tokenize(query), docTokens);
  const embedding = cosine(queryVector, embeddingVector(`${document.title} ${document.content}`, policy?.retrieval?.embeddingDimensions ?? 256));
  const combined = policy?.retrieval?.combine === "lexical-and-embedding" ? 0.6 * lexical + 0.4 * embedding : lexical;
  return { lexical: round4(lexical), embedding: round4(embedding), score: round4(combined) };
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Kør en søgning for en principal.
 *
 * @param options.index      FileKnowledgeIndex
 * @param options.principal  verificeret principal
 * @param options.query      søgestreng
 * @param options.policy     SearchIndexPolicy
 * @param options.aclResolver  (doc) => aktuel ACL fra kilden (valgfri)
 */
export function retrieve({ index, principal, query, policy, aclResolver = null } = {}) {
  const p = normalizePrincipal(principal);
  if (!p || !p.tenantId) {
    return { tenantId: null, subject: null, results: [], accessDecision: { readAllowed: false, filteredDocuments: 0, deniedDocuments: 0 }, candidates: 0, denied: 1 };
  }
  const documents = index.list({ tenantId: p.tenantId, includeDeleted: true });
  const { authorized, denied, tombstoned } = filterAuthorized({ principal, documents, aclResolver });
  const queryVector = embeddingVector(query, policy?.retrieval?.embeddingDimensions ?? 256);
  const results = authorized
    .map((document) => ({ document, ...scoreDocument({ query, queryVector, document, policy }) }))
    .filter((r) => r.score >= (policy?.retrieval?.minScore ?? 0))
    .sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id))
    .slice(0, policy?.retrieval?.maxResults ?? 5);
  return {
    tenantId: p.tenantId,
    subject: p.subject,
    query,
    results,
    candidates: documents.length,
    accessDecision: {
      readAllowed: true,
      filteredDocuments: authorized.length,
      deniedDocuments: denied.length + tombstoned.length,
    },
  };
}

/** Embedding-søgning alene; bruger samme tenant-/ACL-filter først. */
export function embeddingRetrieve(options) {
  const result = retrieve(options);
  const sorted = [...result.results].sort((a, b) => b.embedding - a.embedding || a.document.id.localeCompare(b.document.id));
  return { ...result, results: sorted };
}

/** Cache-nøgle bundet til tenant, subjekt, forespørgsel og indeks-epoch. */
export function retrievalCacheKey({ tenantId, subject, query, epoch }) {
  return digestOf({ tenantId, subject, query, epoch });
}
