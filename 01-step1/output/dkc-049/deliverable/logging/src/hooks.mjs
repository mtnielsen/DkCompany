/**
 * DKC-049 — integrationshooks for runtime og tjenester.
 *
 * Runtimen og audit-servicen kalder en observer ved beslutninger og
 * handlinger. `createRuntimeLogObserver` og `createAuditLogObserver` omsætter
 * de begivenheder til komplette logposter med korrelation, provenance og
 * redaktion og skriver dem til ledgeren. Observatøren er bevidst best-effort:
 * den kan berige sporet, men ikke blokere eller ændre eksekveringen. Den
 * obligatoriske holdbare kvittering ligger i den to-fasede journal (DKC-009)
 * og i `receipt.mjs`.
 */
import { isResourceId } from "../../identity/src/tenant.mjs";
import { buildLogRecord } from "./record.mjs";
import { digest } from "./canonical.mjs";

const iso = (ms) => new Date(ms).toISOString();

function scopeFor({ tenantId, service, environment, target }) {
  const tenant = tenantId ?? "platform";
  const resource = isResourceId(target) ? target : `res://${tenant}/service/${service}`;
  return { tenantId: tenant, environment: environment ?? "dev", service, resource };
}

function correlationFor(event, fallbackId) {
  return event.correlation ?? { correlationId: fallbackId, executionId: fallbackId };
}

function appendVerified({ ledger, policy, occurredAt, correlation, scope, phase, summary, reason }) {
  return ledger.append(
    buildLogRecord(
      {
        occurredAt,
        correlation,
        scope,
        provenance: "verified",
        verification: {
          verifier: "platform.runtime",
          method: phase,
          artifactDigest: digest({ phase, summary: summary ?? null, reason: reason ?? null }),
          result: phase === "action.failed" ? "fail" : "pass",
          verifiedAt: occurredAt,
        },
        dataClassification: "operational",
        retentionClass: "operational",
      },
      { policy }
    )
  );
}

function appendSystem({ ledger, policy, occurredAt, correlation, scope, phase, value }) {
  return ledger.append(
    buildLogRecord(
      {
        occurredAt,
        correlation,
        scope,
        provenance: "system",
        observation: { source: `observer:${phase}`, freshness: "fresh", value },
        dataClassification: "operational",
        retentionClass: "operational",
      },
      { policy }
    )
  );
}

export function createRuntimeLogObserver({ ledger, manifest = null, policy = null, clock = () => Date.now() } = {}) {
  if (!ledger) throw new Error("createRuntimeLogObserver kræver en ledger");
  return async function onRuntimeEvent(event) {
    const service = event.serviceName ?? event.agentRef ?? manifest?.metadata?.name ?? "runtime";
    const scope = scopeFor({ tenantId: event.tenantId, service, environment: event.environment, target: event.target });
    const occurredAt = iso(clock());
    const correlation = correlationFor(event, `${service}:${event.taskId ?? "task"}`);
    if (event.phase === "action.completed" || event.phase === "action.failed") {
      return appendVerified({ ledger, policy, occurredAt, correlation, scope, phase: event.phase, summary: event.summary, reason: event.reason });
    }
    return appendSystem({
      ledger,
      policy,
      occurredAt,
      correlation,
      scope,
      phase: event.phase,
      value: {
        decision: event.decision ?? null,
        reason: event.reason ?? null,
        summary: event.summary ?? null,
        objective: event.objective ?? null,
        target: event.target ?? null,
      },
    });
  };
}

export function createAuditLogObserver({ ledger, policy = null, clock = () => Date.now() } = {}) {
  if (!ledger) throw new Error("createAuditLogObserver kræver en ledger");
  return async function onServiceEvent(event) {
    const service = event.serviceName ?? "audit-service";
    const scope = scopeFor({ tenantId: event.tenantId, service, environment: event.environment, target: event.target });
    const occurredAt = iso(clock());
    const correlation = correlationFor(event, `${service}:${event.auditEventId ?? "request"}`);
    if (event.phase === "action.completed") {
      return appendVerified({ ledger, policy, occurredAt, correlation, scope, phase: event.phase, summary: event.auditEventId, reason: null });
    }
    return appendSystem({ ledger, policy, occurredAt, correlation, scope, phase: event.phase, value: { decision: event.decision ?? null, reason: event.reason ?? null, auditEventId: event.auditEventId ?? null } });
  };
}
