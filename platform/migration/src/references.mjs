/**
 * DKC-031 — tenantafgrænset stabil reference for migrerede objekter.
 *
 * Et kildeobjekt har sin egen lokale id i upstream (fx Nextclouds fil-id eller
 * EspoCRMs numeriske id). Den er ikke tenantafgrænset. Migrationen udleder
 * derfor en **stabil reference** af formen
 * `mig:<tenantId>:<appId>:<entityType>:<sourceObjectId>`. Den ændrer sig ikke,
 * når objektet gen-importeres eller opdateres, og en reference fra en anden
 * tenant afvises (fail-closed), så et objekt ikke kan læses eller overskrives
 * på tværs af kunder.
 */
import { digestOf } from "../../runtime/src/digest.mjs";
import { PILOT_APPS, ENTITY_TYPES } from "./model.mjs";

export class MigrationReferenceError extends Error {
  constructor(message, code = "migration_reference_error") {
    super(message);
    this.name = "MigrationReferenceError";
    this.code = code;
  }
}

const REFERENCE_RE = /^mig:([a-z0-9][a-z0-9-]{1,62}):([a-z]+):([A-Za-z]+):([A-Za-z0-9._-]+)$/;

export function buildReference({ tenantId, appId, entityType, sourceObjectId } = {}) {
  if (!tenantId) throw new MigrationReferenceError("buildReference kræver en tenantId", "missing_tenant");
  if (!PILOT_APPS.includes(appId)) throw new MigrationReferenceError(`ukendt pilotapp '${appId}'`, "unknown_app");
  if (!(ENTITY_TYPES[appId] ?? []).includes(entityType)) {
    throw new MigrationReferenceError(`ukendt entitetstype '${entityType}' for '${appId}'`, "unknown_entity");
  }
  if (sourceObjectId === undefined || sourceObjectId === null || String(sourceObjectId) === "") {
    throw new MigrationReferenceError("buildReference kræver et kildeobjekt-id", "missing_source_id");
  }
  return `mig:${tenantId}:${appId}:${entityType}:${String(sourceObjectId)}`;
}

export function parseReference(reference) {
  const match = REFERENCE_RE.exec(String(reference ?? ""));
  if (!match) throw new MigrationReferenceError(`'${reference}' er ikke en gyldig migrationsreference`, "malformed_reference");
  return { tenantId: match[1], appId: match[2], entityType: match[3], sourceObjectId: match[4] };
}

export function assertReferenceTenant(reference, tenantId) {
  const parsed = parseReference(reference);
  if (parsed.tenantId !== tenantId) {
    throw new MigrationReferenceError(`referencen '${reference}' tilhører tenanten '${parsed.tenantId}', ikke '${tenantId}'`, "cross_tenant_reference");
  }
  return parsed;
}

/** En deterministisk digest af referencen, så et kilde-id aldrig lækkes som nøgle. */
export function referenceDigest(reference) {
  return digestOf(parseReference(reference));
}
