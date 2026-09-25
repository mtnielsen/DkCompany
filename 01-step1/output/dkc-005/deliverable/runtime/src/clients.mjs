export class GovernanceUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "GovernanceUnavailable";
  }
}

export class AuditUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "AuditUnavailable";
  }
}

export class ApprovalUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "ApprovalUnavailable";
  }
}

/**
 * Approval-verifier. Runtimen må ikke stole på `action.approvals`; den skal have
 * en serververificeret, ændringsbundet beslutning og forbruge den atomisk.
 * Understøtter både en in-process service (fx `createApprovalService`) og et
 * HTTP-endpoint. En utilgængelig tjeneste kaster `ApprovalUnavailable`.
 */
export function createApprovalClient({ service = null, endpoint = null, fetchImpl = globalThis.fetch, timeoutMs = 2000 } = {}) {
  if (!service && !endpoint) throw new Error("createApprovalClient kræver en 'service' eller et 'endpoint'");
  return {
    kind: "approval",
    async authorizeExecution(descriptor) {
      if (service) {
        try {
          return await service.authorizeExecution(descriptor.approvalId, descriptor);
        } catch (err) {
          throw new ApprovalUnavailable(`approval-service utilgængelig: ${err.message}`);
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${endpoint.replace(/\/$/, "")}/v1/approvals/${encodeURIComponent(descriptor.approvalId)}/authorize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(descriptor),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        throw new ApprovalUnavailable(`approval-service utilgængelig: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** PDP-klient. Fail-closed: kan PDP'en ikke nås, kastes GovernanceUnavailable. */
export function createPdpClient({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 2000 }) {
  return {
    endpoint,
    async decide(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        return payload.result ?? payload;
      } catch (err) {
        throw new GovernanceUnavailable(`PDP utilgængelig: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Gateway-klient. Runtimen kan kun nå en model gennem gatewayen. */
export function createGatewayClient({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  return {
    endpoint,
    async complete({ agentRef, model, messages, maxTokens, routeId }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "x-agent-ref": agentRef, ...(routeId ? { "x-route": routeId } : {}) },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
          signal: controller.signal,
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
        return { text: payload.choices?.[0]?.message?.content ?? "", tokens: payload.usage?.total_tokens ?? 0, costEur: payload.usage?.cost_eur ?? 0, model: payload.model, modelVersion: payload.modelVersion };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Audit-log-klient. Kan loggen ikke nås, kastes AuditUnavailable (dødemandsgreb). */
export function createHttpAuditLog({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 2000 }) {
  return {
    endpoint,
    async append(event) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json().catch(() => ({}));
      } catch (err) {
        throw new AuditUnavailable(`audit-log utilgængelig: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** In-memory audit-log til tests og lokal kørsel. */
export function createMemoryAuditLog({ fail = false } = {}) {
  const events = [];
  return {
    events,
    async append(event) {
      if (fail) throw new AuditUnavailable("audit-log utilgængelig (simuleret)");
      events.push(event);
      return { ok: true };
    },
  };
}
