/**
 * DKC-028 — svar med kildehenvisning, usikkerhed og adgangskontrol ved læsning.
 *
 * Svaret bygges kun på dokumenter, der allerede er tenant- og ACL-filtreret i
 * retrieval. Hvert uddrag pakkes som **ubetroet indhold** gennem runtimens
 * grænse (DKC-011) og scannes for injektionsmønstre. Et dokument kan derfor
 * beskrive et værktøjskald, men det kan aldrig blive et: `toolProposals` er
 * tom, og `toolActivationDenied` er altid sand. Svar og snippets er data, ikke
 * en befaling.
 */
import { createUntrustedContent } from "../../runtime/src/untrusted.mjs";
import { scanUntrusted } from "../../runtime/src/injection.mjs";

const SNIPPET_CHARS = 240;

function snippetOf(document) {
  const text = String(document.content ?? "").replace(/\s+/g, " ").trim();
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text;
}

function uncertaintyFor({ results, injection }) {
  const top = results[0]?.score ?? 0;
  if (results.length === 0) {
    return { level: "high", score: 0, reason: "Ingen autoriserede kilder matchede forespørgslen; svaret er ikke understøttet." };
  }
  if (injection.length > 0) {
    return {
      level: "high",
      score: Math.min(1, top),
      reason: `Kilden indeholder injektionssignaler (${injection.join(", ")}); indholdet er neutraliseret og kan ikke udføre handlinger.`,
    };
  }
  if (top < 0.25) {
    return { level: "high", score: Number(top.toFixed(4)), reason: "Kilderne matcher kun svagt; bekræft svaret i den citerede artikel." };
  }
  if (top < 0.6) {
    return { level: "medium", score: Number(top.toFixed(4)), reason: "Kilderne matcher delvist; læs den citerede artikel før beslutning." };
  }
  return { level: "low", score: Number(top.toFixed(4)), reason: "Kilderne matcher forespørgslen direkte." };
}

/**
 * Byg et svar fra et retrieval-resultat.
 *
 * @param options.query
 * @param options.principal
 * @param options.retrieval   resultat fra `retrieve()`.
 * @param options.policy      SearchIndexPolicy.
 */
export function buildAnswer({ query, principal, retrieval, policy }) {
  const results = retrieval?.results ?? [];
  const content = [];
  const citations = [];
  const injectionFindings = new Set();
  for (const result of results) {
    const document = result.document;
    const untrusted = createUntrustedContent({
      kind: "document",
      source: `${document.sourceId}:${document.externalId}`,
      text: snippetOf(document),
      tenantId: document.tenantId,
    });
    content.push(untrusted);
    const scan = scanUntrusted(untrusted.text);
    for (const finding of scan.findings) injectionFindings.add(finding);
    citations.push({
      documentId: document.id,
      sourceId: document.sourceId,
      title: document.title,
      url: document.bookstack?.url ?? `https://knowledge.example/${document.externalId}`,
      snippet: untrusted.text,
      classification: document.classification,
    });
  }

  const injection = [...injectionFindings];
  const uncertainty = uncertaintyFor({ results, injection });
  const answerText = results.length
    ? `Baseret på ${results.length} autoriserede kilde(r):\n\n${citations.map((c, i) => `[${i + 1}] ${c.title}: ${c.snippet}`).join("\n\n")}`
    : "Der findes ingen autoriseret kilde, der besvarer forespørgslen.";

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "RetrievalAnswer",
    query,
    tenantId: retrieval?.tenantId ?? null,
    subject: retrieval?.subject ?? null,
    answerText,
    uncertainty,
    citations,
    untrusted: true,
    executable: false,
    toolProposals: [],
    toolActivationDenied: true,
    accessDecision: retrieval?.accessDecision ?? { readAllowed: false, filteredDocuments: 0, deniedDocuments: 0 },
    injectionFindings: injection,
    policyRef: policy ? "search/index-policy.json" : null,
  };
}
