/**
 * DKC-012 — afregning: atomisk budgetreservation + idempotens.
 *
 * Gatewayen reserverer et maksimalt beløb *før* leverandørkaldet (input +
 * route'ens max-output), afregner det faktiske brug bagefter og frigiver
 * resten. Dermed kan to samtidige kald ikke bruge den samme resterende
 * budgetpost, og et timeout/afbrudt stream efterlader ikke et reserveret beløb.
 *
 * Idempotens og reservation deler den samme `idempotency_key`, så en gentaget
 * request hverken kalder leverandøren eller budgettet to gange.
 */
import { createHash, randomUUID } from "node:crypto";

function digestOf(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function estimateTokens(messages) {
  const text = Array.isArray(messages)
    ? messages.map((m) => (typeof m === "string" ? m : `${m?.role ?? ""}:${m?.content ?? ""}`)).join("\n")
    : "";
  return Math.max(1, Math.ceil(text.length / 4));
}

export class AccountingError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccountingError";
  }
}

export function createGatewayAccounting({ budgetStore, callStore = null, clock = () => Date.now() } = {}) {
  const budgetKeyOf = (route) => route.budgetKey ?? route.id;

  /** Estimer den maksimale reserverbare mængde for et kald. */
  function estimate({ route, messages, maxOutputTokens }) {
    const output = maxOutputTokens ?? route.maxOutputTokens ?? 1024;
    const tokens = estimateTokens(messages) + output;
    const perToken = route.costPerTokenEur ?? 0;
    return { tokens, costEur: tokens * perToken };
  }

  function requestDigest({ agentRef, route, model, maxTokens, messages, dataClass }) {
    return digestOf({ agentRef, routeId: route.id, model: model ?? null, maxTokens: maxTokens ?? null, messages, dataClass });
  }

  return {
    digestOf,
    budgetKeyOf,
    estimate,
    requestDigest,
    /**
     * Start et kald: krav idempotency-nøglen og reservér budgettet atomisk.
     * Mulige statusser: `new`, `replay`, `conflict`, `in-flight`, `exceeded`.
     */
    begin({ tenantId, agentRef, resolved, messages, maxOutputTokens, idempotencyKey }) {
      const route = resolved.route;
      const requestDigest = this.requestDigest({ agentRef, route, model: resolved.route.model, maxTokens: maxOutputTokens, messages, dataClass: resolved.dataClass });

      if (callStore) {
        const claim = callStore.claim({ tenantId, idempotencyKey, requestDigest, route, dataClass: resolved.dataClass });
        if (claim.status === "replay") return { status: "replay", record: claim.record, requestDigest };
        if (claim.status === "conflict") return { status: "conflict", record: claim.record, requestDigest };
        if (claim.status === "in-flight") return { status: "in-flight", record: claim.record, requestDigest };
      }

      if (!budgetStore) return { status: "new", reservationId: null, requestDigest, estimate: estimate({ route, messages, maxOutputTokens }) };

      const est = estimate({ route, messages, maxOutputTokens });
      const reservationId = `res_${randomUUID()}`;
      const reservation = budgetStore.reserve(tenantId, budgetKeyOf(route), {
        tokens: est.tokens,
        costEur: est.costEur,
        reservationId,
        idempotencyKey,
        ceilingTokens: route.maxTokens ?? null,
        ceilingCostEur: route.maxCostEur ?? null,
      });
      if (!reservation.ok && reservation.exceeded) {
        // Frigiv idempotency-kravet, så klienten kan genforsøge når budgettet
        // igen er ledigt.
        if (callStore) callStore.release({ tenantId, idempotencyKey, tokens: 0, costEur: 0 });
        return { status: "exceeded", reservation, requestDigest };
      }
      if (!reservation.ok) {
        if (callStore) callStore.release({ tenantId, idempotencyKey, tokens: 0, costEur: 0 });
        throw new AccountingError(`kunne ikke reservere budget: ${reservation.reason ?? "ukendt"}`);
      }
      if (callStore) callStore.attachReservation({ tenantId, idempotencyKey, reservationId });
      return { status: "new", reservationId, estimate: est, requestDigest };
    },
    /** Afregn faktisk forbrug og gem kvitteringen. */
    settle({ tenantId, resolved, idempotencyKey, reservationId, tokens = 0, costEur = 0, response = null }) {
      let budget = null;
      if (reservationId && budgetStore) budget = budgetStore.settle(reservationId, { tokens, costEur });
      const call = callStore ? callStore.settle({ tenantId, idempotencyKey, tokens, costEur, response, dataClass: resolved.dataClass }) : null;
      return { budget, call };
    },
    /** Frigiv reservationen efter timeout/afbrudt kald/leverandørfejl uden forbrug. */
    release({ tenantId, idempotencyKey, reservationId, tokens = 0, costEur = 0 }) {
      let budget = null;
      if (reservationId && budgetStore) budget = budgetStore.release(reservationId);
      const call = callStore ? callStore.release({ tenantId, idempotencyKey, tokens, costEur }) : null;
      return { budget, call };
    },
    /**
     * Afbrydelse med delvist forbrug: afregn det modtagne på budgettet, men
     * frigiv idempotency-kravet, så et retry med samme nøgle kan gennemføres
     * (og afregnes separat). Det giver korrekt opgørelse af både det afbrudte
     * og det genoptagne kald.
     */
    interrupt({ tenantId, idempotencyKey, reservationId, tokens = 0, costEur = 0 }) {
      let budget = null;
      if (reservationId && budgetStore) budget = budgetStore.settle(reservationId, { tokens, costEur });
      const call = callStore ? callStore.release({ tenantId, idempotencyKey, tokens, costEur }) : null;
      return { budget, call };
    },
    getReservation(reservationId) {
      return budgetStore ? budgetStore.getReservation(reservationId) : null;
    },
  };
}
