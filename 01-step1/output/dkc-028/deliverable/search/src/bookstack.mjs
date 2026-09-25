/**
 * DKC-028 — read-only BookStack-klient og mapping til KnowledgeDocument.
 *
 * Klienten læser kun. Den oversætter BookStacks sider og deres
 * content-permissions til platformens dokument- og ACL-model. Al tekst
 * behandles som ubetroet data af søgelaget; klienten fortolker den aldrig som
 * en instruktion eller et værktøjskald.
 */
import { sha256Hex, digestOf } from "../../runtime/src/digest.mjs";

const DEFAULT_CLASSIFICATION = "internal";

function normalizeUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/$/, "")}${path}`;
}

/** Klient mod BookStacks read-only API. */
export function createBookstackClient({ baseUrl, token, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new Error("createBookstackClient kræver baseUrl");
  async function request(path, { method = "GET" } = {}) {
    const res = await fetchImpl(normalizeUrl(baseUrl, path), {
      method,
      headers: { authorization: `Token ${token}`, accept: "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = new Error(`BookStack ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      error.status = res.status;
      const retryAfter = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
      if (retryAfter) error.retryAfterSeconds = Number(retryAfter) || retryAfter;
      throw error;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }
  return {
    ping: () => request("/api/docs"),
    listBooks: () => request("/api/books"),
    listPages: ({ count = 500, offset = 0 } = {}) => request(`/api/pages?count=${count}&offset=${offset}`),
    readPage: (id) => request(`/api/pages/${encodeURIComponent(id)}`),
    pagePermissions: (id) => request(`/api/pages/${encodeURIComponent(id)}/permissions`),
  };
}

/** Map en BookStack-side (med permissions) til et KnowledgeDocument. */
export function mapPageToDocument(page, { source, permissions = null } = {}) {
  if (!page?.id) throw new Error("mapPageToDocument kræver en side med id");
  const acl = permissions ?? page.permissions ?? { readGroups: [], readSubjects: [], denyGroups: [], denySubjects: [] };
  const content = page.markdown ?? page.html ?? page.content ?? "";
  const classification = page.classification ?? source.classificationDefault ?? DEFAULT_CLASSIFICATION;
  const book = page.book?.name ?? page.book ?? page.book_id ?? "unknown";
  const chapter = page.chapter?.name ?? page.chapter ?? page.chapter_id ?? null;
  const base = source.baseUrl ?? "https://knowledge.example";
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "KnowledgeDocument",
    id: `${source.id}:${page.id}`,
    sourceId: source.id,
    tenantId: source.tenantId,
    externalId: String(page.id),
    title: page.name ?? page.title ?? `Page ${page.id}`,
    classification,
    acl: {
      readGroups: [...(acl.readGroups ?? [])].sort(),
      readSubjects: [...(acl.readSubjects ?? [])].sort(),
      denyGroups: [...(acl.denyGroups ?? [])].sort(),
      denySubjects: [...(acl.denySubjects ?? [])].sort(),
      ownerSubject: acl.ownerSubject ?? page.owned_by ?? page.ownerSubject ?? null,
    },
    contentSha256: sha256Hex(content),
    updatedAt: page.updated_at ?? page.updatedAt ?? new Date(0).toISOString(),
    deletedAt: page.deletedAt ?? null,
    content,
    bookstack: {
      book: String(book),
      chapter: chapter === null ? null : String(chapter),
      slug: page.slug ?? String(page.id),
      url: page.url ?? `${String(base).replace(/\/$/, "")}/books/${encodeURIComponent(String(book))}/page/${page.slug ?? page.id}`,
    },
  };
}

/** Deterministisk digest af et dokuments ACL, så ændringer kan opdages. */
export function aclDigest(doc) {
  return digestOf(doc.acl ?? {});
}
