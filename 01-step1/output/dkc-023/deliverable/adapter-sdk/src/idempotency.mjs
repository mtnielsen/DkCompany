/**
 * DKC-023 — idempotens for adapterverber.
 *
 * SDK'en kræver en idempotens-store med samme kontrakt som den holdbare
 * SQLite-adapter i persistenslaget (`persistence/src/adapters/adapter-idempotency.mjs`).
 * Denne fil giver:
 *
 *   - `createMemoryIdempotencyStore()` — deterministisk, til tests og offline
 *     harness-kørsler. Den er bevidst ikke produktionsstandarden.
 *   - `createDurableIdempotencyStore({ db })` — videreformidler den holdbare
 *     adapter, så et svar overlever genstart og deles mellem replikaer.
 *
 * Kontrakten er ens for begge, så SDK'en ikke kan vælge en svagere semantik ved
 * et uheld.
 */
import { createSqliteAdapterIdempotencyStore, requestDigest } from "../../persistence/src/index.mjs";

function keyOf(tenantId, scope, idempotencyKey) {
  return `${tenantId ?? ""}\u0000${scope}\u0000${idempotencyKey}`;
}

export function createMemoryIdempotencyStore({ clock = () => Date.now() } = {}) {
  const records = new Map();
  return {
    kind: "memory-idempotency",
    digestOf: requestDigest,
    claim({ tenantId, scope, idempotencyKey, request }) {
      const k = keyOf(tenantId, scope, idempotencyKey);
      const digest = requestDigest(request ?? {});
      const at = new Date(clock()).toISOString();
      const existing = records.get(k);
      if (existing) {
        if (existing.requestDigest !== digest) return { status: "conflict", record: existing };
        if (existing.state === "completed") return { status: "replay", record: existing };
        if (existing.state === "failed") {
          const revived = { ...existing, state: "in-progress", error: null, updatedAt: at };
          records.set(k, revived);
          return { status: "new", record: revived };
        }
        return { status: "in-flight", record: existing };
      }
      const created = { tenantId, scope, idempotencyKey, requestDigest: digest, state: "in-progress", response: null, error: null, createdAt: at, updatedAt: at };
      records.set(k, created);
      return { status: "new", record: created };
    },
    complete({ tenantId, scope, idempotencyKey, response = null, replayable = true }) {
      const k = keyOf(tenantId, scope, idempotencyKey);
      const existing = records.get(k);
      if (!existing) throw new Error(`ukendt idempotency-nøgle '${idempotencyKey}'`);
      const record = { ...existing, state: "completed", response: replayable ? response : null, updatedAt: new Date(clock()).toISOString() };
      records.set(k, record);
      return record;
    },
    fail({ tenantId, scope, idempotencyKey, error = null }) {
      const k = keyOf(tenantId, scope, idempotencyKey);
      const existing = records.get(k);
      if (!existing) throw new Error(`ukendt idempotency-nøgle '${idempotencyKey}'`);
      const record = { ...existing, state: "failed", error, updatedAt: new Date(clock()).toISOString() };
      records.set(k, record);
      return record;
    },
    get(tenantId, scope, idempotencyKey) {
      return records.get(keyOf(tenantId, scope, idempotencyKey)) ?? null;
    },
  };
}

/**
 * Holdbar store oven på en åbnet persistens-database. Migrations skal være
 * anvendt (fx via `openDatabase` + `createMigrator(...).apply()`).
 */
export function createDurableIdempotencyStore({ db, clock } = {}) {
  if (!db) throw new Error("createDurableIdempotencyStore kræver en database");
  return createSqliteAdapterIdempotencyStore({ db, ...(clock ? { clock } : {}) });
}
