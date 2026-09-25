/**
 * DKC-049 — logadgang med default-deny og sporet læsning.
 *
 * Læsning af loggen er en privilegeret handling. Tenant udledes altid af den
 * verificerede principal (aldrig af en klientpåstand), og principalen skal
 * derudover have en af politikens læseroller. En nægtet læsning efterlader
 * selv en post, så et forsøg på at trække historik ud ikke kan ske ubemærket.
 */
import { randomUUID } from "node:crypto";
import { requireTenantContext } from "../../identity/src/tenant.mjs";
import { buildLogRecord } from "./record.mjs";

export class LogAccessError extends Error {
  constructor(message, code = "log_access_error") {
    super(message);
    this.name = "LogAccessError";
    this.code = code;
  }
}

export function rolesOf(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])]);
}

const iso = (ms) => new Date(ms).toISOString();

export function createLogAccess({ ledger, policy, clock = () => Date.now() } = {}) {
  if (!ledger) throw new LogAccessError("createLogAccess kræver en ledger", "missing_ledger");
  const readerRoles = policy?.access?.readerRoles ?? [];

  function authorize({ principal, tenantId = null }) {
    const roles = rolesOf(principal);
    // En scoped platformrolle (fx 'platform-admin:globex') opfylder også den
    // uscoped læserrolle 'platform-admin'.
    const roleOk = readerRoles.some((r) => roles.has(r) || [...roles].some((x) => x.startsWith(`${r}:`)));
    try {
      const context = requireTenantContext({ principal, claimed: tenantId ? [tenantId] : [], source: "log-access" });
      if (!roleOk) return { allowed: false, context, reason: "principalen mangler en log-læserrolle" };
      return { allowed: true, context, reason: null };
    } catch (err) {
      return { allowed: false, context: null, reason: err.message };
    }
  }

  function buildDecision({ principal, auth, action, correlationId, resource, records, tenantId }) {
    const tenant = auth.context?.tenantId ?? tenantId ?? "platform";
    const id = randomUUID();
    const streams = [...new Set(records.map((r) => r.ledger?.stream).filter(Boolean))].sort();
    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "LogAccessDecision",
      id,
      at: iso(clock()),
      reader: { subject: principal?.id ?? "unknown", roles: [...rolesOf(principal)].sort() },
      scope: { tenantId: tenant, streams, correlationId: correlationId ?? null, resource: resource ?? null },
      action,
      decision: auth.allowed ? "allow" : "deny",
      reason: auth.reason,
      recordsReturned: records.length,
      crossTenant: Boolean(auth.context?.crossTenant),
      retentionClass: records[0]?.retentionClass ?? null,
      correlationId: correlationId ?? `access-${id}`,
    };
  }

  /** Log access-beslutningen som en systempost, så også læsning er sporet. */
  async function recordDecision(decision) {
    const tenant = decision.scope.tenantId;
    const correlationId = decision.correlationId;
    const record = buildLogRecord(
      {
        occurredAt: decision.at,
        correlation: { correlationId, executionId: `access-${decision.id}` },
        scope: { tenantId: tenant, environment: "dev", service: "logging", resource: `res://${tenant}/audit/log-access` },
        provenance: "system",
        observation: {
          source: "log-access",
          freshness: "fresh",
          value: {
            action: decision.action,
            decision: decision.decision,
            reason: decision.reason,
            recordsReturned: decision.recordsReturned,
            reader: decision.reader.subject,
            crossTenant: decision.crossTenant,
            streams: decision.scope.streams,
          },
        },
        dataClassification: "security",
        retentionClass: "security",
      },
      { policy }
    );
    return ledger.append(record);
  }

  return {
    kind: "log-access",
    authorize,
    /**
     * Læs (eller forsøg på at læse) loggen. Returnerer beslutningen og — ved
     * adgang — de tenant-scopede poster.
     */
    async read({ principal, tenantId = null, action = "read", correlationId = null, executionId = null, resource = null, provenance = null, limit = null } = {}) {
      if (!principal) throw new LogAccessError("logadgang kræver en principal", "missing_principal");
      if (!["read", "export", "verify", "reconstruct"].includes(action)) throw new LogAccessError(`ukendt loghandling '${action}'`, "bad_action");
      const auth = authorize({ principal, tenantId });
      let records = [];
      if (auth.allowed) {
        records = await ledger.read({ tenantId: auth.context.tenantId, correlationId, executionId, resource, provenance, limit });
        for (const record of records) {
          if (record.scope.tenantId !== auth.context.tenantId) {
            throw new LogAccessError(`tenant-lækage: post '${record.id}' tilhører '${record.scope.tenantId}'`, "tenant_leak");
          }
        }
      }
      const decision = buildDecision({ principal, auth, action, correlationId, resource, records, tenantId });
      const stored = await recordDecision(decision);
      return { allowed: auth.allowed, reason: auth.reason, records, decision, decisionRecord: stored.record };
    },
  };
}
