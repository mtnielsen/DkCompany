/**
 * DKC-030 — adapter mod EspoCRM's REST-API (første kandidat efter kandidatcheck).
 *
 * Klienten er en tynd oversættelse: EspoCRM forbliver system-of-record, og
 * platformen spejler posterne med en tenantafgrænset stabil reference. Den
 * læser og skriver kun de felter platformen ejer; en `Idempotency-Key`
 * videresendes på oprettelser, så et retry ikke skaber en dublet upstream.
 */
import { buildReference } from "./references.mjs";
import { dedupKeyFor } from "./dedup.mjs";

const DEFAULT_CLASSIFICATION = {
  Account: "internal",
  Contact: "personal",
  Opportunity: "confidential",
  Activity: "personal",
};

function normalizeUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/$/, "")}${path}`;
}

/** Klient mod EspoCRM's REST-API. */
export function createEspocrmClient({ baseUrl, apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new Error("createEspocrmClient kræver baseUrl");
  async function request(path, { method = "GET", body, idempotencyKey = null } = {}) {
    const headers = { "x-api-key": apiKey, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await fetchImpl(normalizeUrl(baseUrl, path), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = new Error(`EspoCRM ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
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
    ping: () => request("/api/v1/App/user"),
    list: (entityType, { maxSize = 200, offset = 0 } = {}) => request(`/api/v1/${entityType}?maxSize=${maxSize}&offset=${offset}`),
    get: (entityType, id) => request(`/api/v1/${entityType}/${encodeURIComponent(id)}`),
    create: (entityType, data, { idempotencyKey = null } = {}) => request(`/api/v1/${entityType}`, { method: "POST", body: data, idempotencyKey }),
    update: (entityType, id, patch) => request(`/api/v1/${entityType}/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
    remove: (entityType, id) => request(`/api/v1/${entityType}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}

/** Hvilke roller må læse en given entitetstype? */
export function rolesForEntity(source, entityType) {
  return Object.entries(source.roles ?? {})
    .filter(([, def]) => (def.entityTypes ?? []).includes(entityType))
    .map(([role]) => role)
    .sort();
}

/** Map en EspoCRM-post til en platformens CrmRecord med stabil reference. */
export function mapEspocrmRecord(upstream, { source, entityType } = {}) {
  if (!upstream?.id) throw new Error("mapEspocrmRecord kræver en post med id");
  const reference = buildReference({ tenantId: source.tenantId, entityType, upstreamId: upstream.id });
  const ownerSubject = upstream[source.ownerField] ?? null;
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "CrmRecord",
    id: reference,
    reference,
    sourceId: source.id,
    tenantId: source.tenantId,
    entityType,
    upstreamId: String(upstream.id),
    owner: { subject: ownerSubject, tenantId: source.tenantId, role: upstream.ownerRole ?? null },
    name: upstream.name ?? upstream.subject ?? `Post ${upstream.id}`,
    classification: upstream.classification ?? DEFAULT_CLASSIFICATION[entityType] ?? "internal",
    acl: {
      readGroups: [...(upstream.readGroups ?? [])].sort(),
      readSubjects: [...(upstream.readSubjects ?? [])].sort(),
      denyGroups: [...(upstream.denyGroups ?? [])].sort(),
      denySubjects: [...(upstream.denySubjects ?? [])].sort(),
    },
    roles: rolesForEntity(source, entityType),
    dedupKey: dedupKeyFor({ tenantId: source.tenantId, entityType, record: upstream, dedupKeys: source.dedupKeys }),
    version: upstream.version ?? 1,
    data: upstream,
    copies: [],
    createdAt: upstream.createdAt ?? new Date(0).toISOString(),
    updatedAt: upstream.updatedAt ?? upstream.createdAt ?? new Date(0).toISOString(),
    deletedAt: upstream.deletedAt ?? null,
  };
}
