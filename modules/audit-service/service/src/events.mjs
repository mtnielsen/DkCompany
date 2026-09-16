import { randomBytes, randomUUID } from "node:crypto";

export function newTraceId() {
  return randomBytes(16).toString("hex");
}

export function newSpanId() {
  return randomBytes(8).toString("hex");
}

/**
 * Bygger en CloudEvent-envelope med platformens obligatoriske attributter:
 * tenantid, traceid og principal. Samme envelope for menneske og agent.
 */
export function buildCloudEvent({ source, type, principal, tenantId, traceId, spanId, dataCategory = "operational", data = {}, subject }) {
  return {
    specversion: "1.0",
    id: randomUUID(),
    source,
    type,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    ...(subject ? { subject } : {}),
    tenantid: tenantId,
    traceid: traceId ?? newTraceId(),
    spanid: spanId ?? newSpanId(),
    principal,
    dataclassification: dataCategory,
    data,
  };
}
