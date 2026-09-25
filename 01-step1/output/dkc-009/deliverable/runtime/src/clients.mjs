import { randomUUID } from "node:crypto";

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

/**
 * In-memory action-journal til tests og lokal kørsel. Implementerer samme
 * intent/outcome/idempotens-protokol som den holdbare SQLite-journal, så
 * runtimen kan testes uden en database. `fail` simulerer at audit-loggen er
 * utilgængelig.
 */
export function createMemoryActionJournal({ fail = false, clock = () => Date.now() } = {}) {
  const intents = new Map();
  const events = [];
  const key = (tenantId, idempotencyId) => `${tenantId ?? ""}:${idempotencyId}`;
  const parse = (i) => (i ? { ...i } : null);
  return {
    kind: "memory-action-journal",
    events,
    intents,
    async begin({ tenantId = null, idempotencyId, verb, target, environment = null, actor = null, request = {} } = {}) {
      if (fail) throw new AuditUnavailable("audit-log utilgængelig (simuleret)");
      const k = key(tenantId, idempotencyId);
      const existing = intents.get(k);
      if (existing) {
        const outcomeEvent = events.find((e) => e.idempotencyId === idempotencyId && e.phase === "outcome") ?? null;
        return { ok: false, duplicate: true, state: existing.state, outcome: existing.outcome ?? outcomeEvent ?? null, intent: parse(existing) };
      }
      const intent = { tenantId, idempotencyId, intentId: randomUUID(), verb, target, environment, actor, state: "pending", createdAt: new Date(clock()).toISOString(), request };
      intents.set(k, intent);
      events.push({ phase: "intent", tenantId, idempotencyId, intentId: intent.intentId, verb, target, request, at: intent.createdAt });
      return { ok: true, duplicate: false, state: "pending", intent: parse(intent), receipt: { intentId: intent.intentId, idempotencyId, state: "pending" } };
    },
    async complete({ tenantId = null, idempotencyId, outcome = "succeeded", result = null, error = null } = {}) {
      if (fail) throw new AuditUnavailable("audit-log utilgængelig (simuleret)");
      const intent = intents.get(key(tenantId, idempotencyId));
      if (!intent) throw new Error(`intent '${idempotencyId}' findes ikke`);
      if (["succeeded", "failed", "unknown"].includes(intent.state)) return { ok: true, duplicate: true, state: intent.state, outcome: intent.outcome ?? null };
      intent.state = outcome;
      intent.outcome = { result, error };
      events.push({ phase: "outcome", tenantId, idempotencyId, intentId: intent.intentId, verb: intent.verb, outcome, result, error, at: new Date(clock()).toISOString() });
      return { ok: true, duplicate: false, state: outcome, outcome: intent.outcome };
    },
    async lookup({ tenantId = null, idempotencyId } = {}) {
      const intent = intents.get(key(tenantId, idempotencyId));
      return { found: Boolean(intent), state: intent?.state ?? null, intent: parse(intent), outcome: intent?.outcome ?? null, events: [] };
    },
    async markUnknown({ tenantId = null, idempotencyId, reason = "crash" } = {}) {
      const intent = intents.get(key(tenantId, idempotencyId));
      if (!intent) throw new Error(`intent '${idempotencyId}' findes ikke`);
      if (intent.state !== "pending") return { ok: true, duplicate: true, state: intent.state, intent: parse(intent) };
      intent.state = "unknown";
      intent.unknownReason = reason;
      return { ok: true, duplicate: false, state: "unknown", intent: parse(intent) };
    },
    async reconcile({ tenantId = null, idempotencyId, resolve = null } = {}) {
      const found = await this.lookup({ tenantId, idempotencyId });
      if (!found.found) return { ok: false, reason: "not-found" };
      if (found.state === "succeeded" || found.state === "failed") return { ok: true, alreadyResolved: true, state: found.state, outcome: found.outcome };
      if (!resolve) {
        await this.markUnknown({ tenantId, idempotencyId });
        return { ok: true, resolved: false, state: "unknown" };
      }
      const verdict = await resolve(found.intent);
      if (!verdict?.outcome) {
        await this.markUnknown({ tenantId, idempotencyId, reason: "reconciliation kunne ikke afgøre udfaldet" });
        return { ok: true, resolved: false, state: "unknown" };
      }
      const completed = await this.complete({ tenantId, idempotencyId, outcome: verdict.outcome, result: verdict.result ?? null, error: verdict.error ?? null });
      return { ok: true, resolved: true, state: completed.state, outcome: completed.outcome };
    },
    unresolved() {
      return [...intents.values()].filter((i) => i.state === "pending" || i.state === "unknown").map(parse);
    },
  };
}

/**
 * HTTP-klient til action-journalen hos audit-servicen. Bruges af runtimen, når
 * audit er en separat tjeneste. En utilgængelig tjeneste kaster
 * `AuditUnavailable`, så handlingen stoppes før nogen ekstern ændring.
 */
export function createHttpActionJournal({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 2000 } = {}) {
  if (!endpoint) throw new Error("createHttpActionJournal kræver et endpoint");
  const base = endpoint.replace(/\/$/, "");
  async function call(path, { method = "POST", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      throw new AuditUnavailable(`audit-journal utilgængelig: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    kind: "http-action-journal",
    async begin(input) {
      return call("/v1/audit/intents", { body: input });
    },
    async complete({ idempotencyId, ...input }) {
      return call(`/v1/audit/intents/${encodeURIComponent(idempotencyId)}/outcome`, { body: input });
    },
    async lookup({ tenantId, idempotencyId }) {
      const query = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : "";
      return call(`/v1/audit/intents/${encodeURIComponent(idempotencyId)}${query}`, { method: "GET" });
    },
  };
}
