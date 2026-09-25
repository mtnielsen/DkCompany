/**
 * DKC-049 — fælles korrelations-ID'er.
 *
 * En hændelse kan kun rekonstrueres på tværs af servere, hvis alle led bærer
 * samme korrelations- og execution-ID og den samme tenant-/ressourcebinding.
 * `correlationId` binder hele forløbet (alarm → beslutning → handling →
 * fallback), `executionId` binder ét sammenhængende eksekveringsforsøg, og
 * `parentId` peger på den post et led bygger på. Felterne er bevidst simple
 * strenge, så de kan bæres uændret gennem CloudEvents, audit og WORM-arkivet.
 */
import { randomUUID } from "node:crypto";

export const CORRELATION_FIELDS = ["correlationId", "executionId", "incidentId", "changeId", "traceId", "parentId"];

const TRACE_ID_RE = /^[0-9a-f]{32}$/;

const asNullableString = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

export const newCorrelationId = () => randomUUID();
export const newExecutionId = () => randomUUID();

/**
 * Byg en correlation-blok. `correlationId` og `executionId` er obligatoriske;
 * resten er valgfrie referencer og normaliseres til `null` når de mangler.
 */
export function buildCorrelation({ correlationId, executionId, incidentId = null, changeId = null, traceId = null, parentId = null } = {}) {
  if (!correlationId) throw new Error("korrelation kræver et correlationId");
  if (!executionId) throw new Error("korrelation kræver et executionId");
  return Object.freeze({
    correlationId: String(correlationId),
    executionId: String(executionId),
    incidentId: asNullableString(incidentId),
    changeId: asNullableString(changeId),
    traceId: asNullableString(traceId),
    parentId: asNullableString(parentId),
  });
}

/** Semantiske problemer for en correlation-blok (form håndhæves af skemaet). */
export function correlationProblems(correlation) {
  const problems = [];
  if (!correlation || typeof correlation !== "object") {
    return [{ path: "/correlation", message: "correlation mangler eller er ikke et objekt" }];
  }
  for (const field of ["correlationId", "executionId"]) {
    if (typeof correlation[field] !== "string" || correlation[field].length === 0) {
      problems.push({ path: `/correlation/${field}`, message: "obligatorisk korrelationsfelt mangler" });
    }
  }
  if (correlation.traceId !== null && correlation.traceId !== undefined && !TRACE_ID_RE.test(String(correlation.traceId))) {
    problems.push({ path: "/correlation/traceId", message: "traceId skal være 32 hex-tegn" });
  }
  return problems;
}

/**
 * Udvid en correlation til et barn (fx en efterfølgende server eller et
 * retry-forsøg). Et nyt executionId kan gives, men correlationId bevares, så
 * forløbet stadig kan samles.
 */
export function extendCorrelation(parent, { executionId = null, parentId = null } = {}) {
  const base = parent ?? {};
  return buildCorrelation({
    correlationId: base.correlationId,
    executionId: executionId ?? base.executionId,
    incidentId: base.incidentId,
    changeId: base.changeId,
    traceId: base.traceId,
    parentId: parentId ?? base.parentId,
  });
}
