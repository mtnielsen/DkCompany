/**
 * DKC-030 — tenantafgrænset, stabil reference mellem upstream og platform.
 *
 * Upstream (EspoCRM) ejer sine egne numeriske/hex-id'er pr. entitetstype, men
 * de er ikke tenantafgrænsede. Platformen udleder derfor en **stabil
 * reference** af formen `crm:<tenantId>:<entityType>:<upstreamId>`. Den
 * ændrer sig aldrig, når posten opdateres, og en reference fra en anden tenant
 * afvises (fail-closed), så en post ikke kan læses eller overskrives på tværs
 * af kunder.
 */
import { digestOf } from "../../runtime/src/digest.mjs";
import { ENTITY_TYPES } from "./model.mjs";

export class CrmReferenceError extends Error {
  constructor(message, code = "crm_reference_error") {
    super(message);
    this.name = "CrmReferenceError";
    this.code = code;
  }
}

const REFERENCE_RE = /^crm:([a-z0-9][a-z0-9-]{1,62}):([A-Za-z]+):([A-Za-z0-9._-]+)$/;

/** Byg en stabil, tenantafgrænset reference. */
export function buildReference({ tenantId, entityType, upstreamId } = {}) {
  if (!tenantId) throw new CrmReferenceError("buildReference kræver en tenantId", "missing_tenant");
  if (!ENTITY_TYPES.includes(entityType)) throw new CrmReferenceError(`ukendt entitetstype '${entityType}'`, "unknown_entity");
  if (upstreamId === undefined || upstreamId === null || String(upstreamId) === "") {
    throw new CrmReferenceError("buildReference kræver et upstream-id", "missing_upstream_id");
  }
  return `crm:${tenantId}:${entityType}:${String(upstreamId)}`;
}

/** Parse en reference til `{ tenantId, entityType, upstreamId }`. */
export function parseReference(reference) {
  const match = REFERENCE_RE.exec(String(reference ?? ""));
  if (!match) throw new CrmReferenceError(`'${reference}' er ikke en gyldig crm-reference`, "malformed_reference");
  return { tenantId: match[1], entityType: match[2], upstreamId: match[3] };
}

/** Afvis en reference der peger på en anden tenant. */
export function assertReferenceTenant(reference, tenantId) {
  const parsed = parseReference(reference);
  if (parsed.tenantId !== tenantId) {
    throw new CrmReferenceError(`referencen '${reference}' tilhører tenanten '${parsed.tenantId}', ikke '${tenantId}'`, "cross_tenant_reference");
  }
  return parsed;
}

/** En deterministisk digest af referencen, så et upstream-id aldrig lækkes som nøgle. */
export function referenceDigest(reference) {
  return digestOf(parseReference(reference));
}

/** Den kildebundne upstream-reference (til fejlfinding; aldrig en adgangsnøgle). */
export function upstreamReference({ sourceId, entityType, upstreamId } = {}) {
  if (!sourceId || !entityType || upstreamId === undefined) throw new CrmReferenceError("upstreamReference kræver sourceId, entityType og upstreamId");
  return `${sourceId}:${entityType}:${upstreamId}`;
}
