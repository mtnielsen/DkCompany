/**
 * DKC-031 — mapping fra kildeobjekt til platformspost.
 *
 * Mappingen er deterministisk og drevet af de erklærede facetter: for hver
 * facet bruges det kildefelt, kilden har angivet. En facet der er `unsupported`
 * efterlader feltet tomt og registreres som tabt funktionalitet — der
 * fabrikeres aldrig data. Rækkefølgen i lister er stabil, så et dry-run og en
 * senere import giver samme digest.
 */
import { buildReference, assertReferenceTenant } from "./references.mjs";

function sortById(list) {
  return [...list].sort((a, b) => String(a.id ?? a.target ?? a.name ?? "").localeCompare(String(b.id ?? b.target ?? b.name ?? "")));
}

export function normaliseComments(list) {
  if (!Array.isArray(list)) return [];
  return sortById(
    list.map((entry) => ({
      id: String(entry.id ?? ""),
      author: entry.author ?? null,
      text: String(entry.text ?? entry.subject ?? ""),
      kind: entry.kind ?? entry.type ?? null,
      internal: entry.internal === true,
      createdAt: entry.createdAt ?? null,
    })),
  );
}

export function normaliseAttachments(list) {
  if (!Array.isArray(list)) return [];
  return sortById(
    list.map((entry) => ({
      id: String(entry.id ?? ""),
      name: String(entry.name ?? ""),
      contentHash: entry.contentHash ?? null,
      ref: entry.ref ?? null,
    })),
  );
}

export function normaliseLinks(list) {
  if (!Array.isArray(list)) return [];
  return [...list]
    .map((entry) => ({ rel: String(entry.rel ?? "related"), target: String(entry.target ?? "") }))
    .sort((a, b) => `${a.rel}:${a.target}`.localeCompare(`${b.rel}:${b.target}`));
}

export function normaliseAcl(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const asArray = (v) => (Array.isArray(v) ? v.map(String) : []);
  return {
    readSubjects: [...new Set(asArray(value.readSubjects))].sort(),
    readGroups: [...new Set(asArray(value.readGroups))].sort(),
    denySubjects: [...new Set(asArray(value.denySubjects))].sort(),
    denyGroups: [...new Set(asArray(value.denyGroups))].sort(),
  };
}

/** Mappingen af et kildeobjekt. Kaster hvis objektet ikke hører til kilden. */
export function mapSourceObject({ source, object, at = "2026-03-01T00:00:00Z" } = {}) {
  if (source.tenantId !== object.tenantId) {
    const error = new Error(`kildeobjektet '${object.sourceObjectId}' tilhører tenanten '${object.tenantId}', ikke '${source.tenantId}'`);
    error.code = "cross_tenant_object";
    throw error;
  }
  if (!(source.entityTypes ?? []).includes(object.entityType)) {
    const error = new Error(`entitetstypen '${object.entityType}' er ikke erklæret for '${source.id}'`);
    error.code = "unknown_entity";
    throw error;
  }
  const facets = source.facets?.[object.entityType] ?? {};
  const data = object.data ?? {};
  const reference = buildReference({ tenantId: source.tenantId, appId: source.appId, entityType: object.entityType, sourceObjectId: object.sourceObjectId });
  assertReferenceTenant(reference, source.tenantId);

  const ownerField = facets.ownership?.source;
  const ownerSubject = (ownerField && data[ownerField]) || source.defaultOwner;

  const commentsFacet = facets.comments ?? { status: "unsupported" };
  const comments = commentsFacet.status === "full" || commentsFacet.status === "partial" ? normaliseComments(data[commentsFacet.source]) : [];

  const attachmentsFacet = facets.attachments ?? { status: "unsupported" };
  const attachments = attachmentsFacet.status === "full" || attachmentsFacet.status === "partial" ? normaliseAttachments(data[attachmentsFacet.source]) : [];

  const linksFacet = facets.links ?? { status: "unsupported" };
  const links = linksFacet.status === "full" || linksFacet.status === "partial" ? normaliseLinks(data[linksFacet.source]) : [];

  const aclFacet = facets.acl ?? { status: "unsupported" };
  const acl = aclFacet.status === "full" || aclFacet.status === "partial" ? normaliseAcl(data[aclFacet.source]) : normaliseAcl(null);

  const mappedFacets = {
    ownership: facets.ownership?.status === "full",
    timestamps: facets.timestamps?.status === "full",
    comments: commentsFacet.status === "full",
    attachments: attachmentsFacet.status === "full",
    acl: aclFacet.status === "full",
    links: linksFacet.status === "full",
  };

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationRecord",
    id: reference,
    reference,
    appId: source.appId,
    sourceId: source.id,
    tenantId: source.tenantId,
    entityType: object.entityType,
    sourceObjectId: String(object.sourceObjectId),
    owner: { subject: ownerSubject, tenantId: source.tenantId, role: source.roles?.["content-admin"] ? "content-admin" : null },
    name: String(data.name ?? data.subject ?? data.title ?? object.sourceObjectId),
    classification: object.classification ?? "internal",
    acl,
    comments,
    attachments,
    links,
    createdAt: data.createdAt ?? at,
    updatedAt: data.updatedAt ?? at,
    version: 1,
    dedupKey: null,
    mappedFacets,
    data,
  };
}
