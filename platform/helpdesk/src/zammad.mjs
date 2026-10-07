/**
 * DKC-029 — adapter mod Zammads REST-API (første kandidat).
 *
 * Klienten er en tynd oversættelse: Zammad forbliver system-of-record, og
 * platformen spejler sager, køer og historik. Den læser og skriver kun de felter
 * platformen ejer; den fortolker aldrig sagstekst eller vedhæftninger som
 * instruktioner eller værktøjskald. `Idempotency-Key` videresendes, så et retry
 * ikke opretter en dublet.
 */
import { sha256Hex } from "../../runtime/src/digest.mjs";

const DEFAULT_PRIORITY = "normal";

function normalizeUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/$/, "")}${path}`;
}

/** Klient mod Zammads API. */
export function createZammadClient({ baseUrl, token, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new Error("createZammadClient kræver baseUrl");
  async function request(path, { method = "GET", body, idempotencyKey = null } = {}) {
    const headers = { authorization: `Token token=${token}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await fetchImpl(normalizeUrl(baseUrl, path), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = new Error(`Zammad ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
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
    ping: () => request("/api/v1/version"),
    listTickets: ({ perPage = 100, page = 1 } = {}) => request(`/api/v1/tickets?per_page=${perPage}&page=${page}`),
    getTicket: (id) => request(`/api/v1/tickets/${encodeURIComponent(id)}`),
    createTicket: ({ title, group, customer, priority = DEFAULT_PRIORITY, state = "new", idempotencyKey = null } = {}) =>
      request("/api/v1/tickets", { method: "POST", idempotencyKey, body: { title, group, customer, priority, state } }),
    updateTicket: (id, patch) => request(`/api/v1/tickets/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    addArticle: ({ ticketId, body, type = "note", to = null, subject = null, internal = false, idempotencyKey = null } = {}) =>
      request("/api/v1/ticket_articles", { method: "POST", idempotencyKey, body: { ticket_id: ticketId, body, type, to, subject, internal } }),
    listArticles: (ticketId) => request(`/api/v1/ticket_articles?ticket_id=${encodeURIComponent(ticketId)}`),
  };
}

const STATUS_FROM_UPSTREAM = {
  new: "new",
  open: "open",
  "pending reminder": "pending",
  pending: "pending",
  closed: "closed",
};

const PRIORITY_FROM_UPSTREAM = {
  "1 low": "low",
  low: "low",
  "2 normal": "normal",
  normal: "normal",
  "3 high": "high",
  high: "high",
  urgent: "urgent",
  "4 urgent": "urgent",
};

/** Map en Zammad-sag til platformens SupportTicket. */
export function mapZammadTicket(ticket, { source, queue = null } = {}) {
  if (!ticket?.id) throw new Error("mapZammadTicket kræver en sag med id");
  const q = queue ?? (source.queues ?? []).find((x) => x.id === ticket.group) ?? null;
  if (!q) throw new Error(`Zammad-sagen '${ticket.id}' peger på den ukendte kø '${ticket.group}'`);
  const classification = q.classification ?? "internal";
  const articles = ticket.articles ?? [];
  const messages = articles.map((a) => ({
    id: String(a.id),
    direction: a.type === "email" && !a.internal ? "outbound" : "inbound",
    author: a.sender ?? a.from ?? "unknown",
    body: a.body ?? "",
    untrusted: true,
    executable: false,
    at: a.created_at ?? ticket.created_at ?? new Date(0).toISOString(),
    messageId: a.message_id ?? null,
  }));
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "SupportTicket",
    id: `${source.id}:${ticket.id}`,
    sourceId: source.id,
    tenantId: source.tenantId,
    externalId: String(ticket.id),
    number: ticket.number ?? String(ticket.id),
    queueId: q.id,
    queue: {
      id: q.id,
      name: q.name,
      classification: q.classification,
      externalVisible: q.externalVisible === true,
      acl: {
        readGroups: [...(q.acl?.readGroups ?? [])].sort(),
        readSubjects: [...(q.acl?.readSubjects ?? [])].sort(),
        denyGroups: [...(q.acl?.denyGroups ?? [])].sort(),
        denySubjects: [...(q.acl?.denySubjects ?? [])].sort(),
      },
    },
    subject: ticket.title ?? `Sag ${ticket.id}`,
    requester: {
      subject: ticket.customer?.subject ?? null,
      name: ticket.customer?.name ?? null,
      email: ticket.customer?.email ?? null,
      tenantId: source.tenantId,
    },
    channel: ticket.channel ?? "email",
    priority: PRIORITY_FROM_UPSTREAM[ticket.priority] ?? DEFAULT_PRIORITY,
    status: STATUS_FROM_UPSTREAM[ticket.state] ?? "new",
    classification,
    acl: {
      readGroups: [...(q.acl?.readGroups ?? [])].sort(),
      readSubjects: [...(q.acl?.readSubjects ?? [])].sort(),
      denyGroups: [...(q.acl?.denyGroups ?? [])].sort(),
      denySubjects: [...(q.acl?.denySubjects ?? [])].sort(),
    },
    sla: {
      firstResponseDueAt: ticket.sla?.firstResponseDueAt ?? null,
      resolutionDueAt: ticket.sla?.resolutionDueAt ?? null,
    },
    createdAt: ticket.created_at ?? new Date(0).toISOString(),
    updatedAt: ticket.updated_at ?? ticket.created_at ?? new Date(0).toISOString(),
    closedAt: ticket.closed_at ?? null,
    messages,
    attachments: [],
    history: [],
    upstream: {
      state: ticket.state ?? null,
      group: ticket.group ?? null,
      contentSha256: sha256Hex(JSON.stringify({ title: ticket.title, articles })),
    },
  };
}
