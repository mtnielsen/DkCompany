/**
 * DKC-040 — fælles begivenhedskontrakt for holdbar beskedudveksling.
 *
 * Modulet bygger og validerer de CloudEvents 1.0-enveloper som outbox/inbox
 * udveksler. Hver begivenhed er bundet til sin tenant og bærer et
 * ressource-versionsfelt, så logisk rækkefølge kan håndhæves pr. ressource.
 * En begivenhed uden tenant-binding eller versionsfelt afvises, frem for at
 * efterlade rækkefølge og ejerskab til tilfældigheder.
 */
import { createHash } from "node:crypto";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

export const EVENT_STATUSES = ["pending", "confirmed", "failed"];
export const INBOX_STATUSES = ["received", "processing", "processed", "skipped", "failed", "dead-letter"];
export const ORDERING_MODES = ["per-resource", "none"];

const EVENT_TYPE_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Deterministisk JSON: nøgler sorteres, så digesten er stabil. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** SHA-256 over den kanoniske form; bruges til dedup og tamper-detektion. */
export function eventDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Byg en CloudEvent-envelope med de obligatoriske platform-extensioner.
 * `resource` binder begivenheden til den ressource hvis version den bærer.
 */
export function buildCloudEvent({
  tenantId,
  id,
  type,
  source,
  subject = null,
  time = new Date().toISOString(),
  resource,
  traceId,
  spanId = null,
  principal,
  dataclassification = "operational",
  data = {},
} = {}) {
  const tenant = normalizeTenantId(tenantId);
  if (typeof id !== "string" || id.trim() === "") throw new Error("begivenheden mangler et id");
  if (!EVENT_TYPE_RE.test(type ?? "")) throw new Error(`ugyldig begivenhedstype '${type}'`);
  if (typeof source !== "string" || source.trim() === "") throw new Error("begivenheden mangler en source");
  if (!resource || typeof resource.type !== "string" || typeof resource.id !== "string" || resource.id === "") {
    throw new Error("begivenheden mangler en ressource (type + id)");
  }
  if (!Number.isInteger(resource.version) || resource.version < 0) {
    throw new Error("begivenheden mangler en ikke-negativ ressource-version");
  }
  if (!principal || typeof principal.kind !== "string" || typeof principal.id !== "string") {
    throw new Error("begivenheden mangler en principal");
  }
  return {
    specversion: "1.0",
    id,
    source,
    type,
    time,
    datacontenttype: "application/json",
    subject: subject ?? `${resource.type}/${resource.id}`,
    tenantid: tenant,
    traceid: traceId,
    ...(spanId ? { spanid: spanId } : {}),
    principal,
    dataclassification,
    data: { ...data, resource },
  };
}

/** Træk den tenantbundne ressource ud af en envelope. */
export function resourceOf(event) {
  const resource = event?.data?.resource;
  if (!resource || typeof resource.type !== "string" || typeof resource.id !== "string") {
    throw new Error("begivenheden bærer ikke en ressource i data.resource");
  }
  return { type: resource.type, id: resource.id, version: resource.version ?? 0 };
}

/** Krydskunde-kontrol: envelopens tenant skal matche den forventede tenant. */
export function assertTenantBound(event, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  if (event?.tenantid !== tenant) {
    throw new Error(`begivenheden '${event?.id}' er bundet til en anden tenant end '${tenant}'`);
  }
  return true;
}
