/**
 * DKC-023 — holdbar idempotens for adapterverber.
 *
 * Adapter-SDK'en kalder denne adapter for hvert gated verbum, der bærer en
 * `idempotencyKey`. Den første kalder vinder kravet atomisk; en gentaget request
 * med samme nøgle og samme request-digest får den gemte kvittering uden at
 * ramme upstream igen; samme nøgle med et andet indhold afvises som konflikt.
 *
 * Adapteren deler `adapter_idempotency`-tabellen på tværs af verber via
 * `scope` (fx `mattermost-adapter:subject.erase`). Rå svar gemmes kun for
 * scope-navne, kalderen har markeret som `replayable`; ellers gemmes alene
 * digest og metadata, så idempotens-loggen ikke bliver et personregister.
 */
import { createHash } from "node:crypto";
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/** Kanonisk SHA-256 over requestens indhold. */
export function requestDigest(request) {
  return createHash("sha256").update(canonical(request)).digest("hex");
}

export function createSqliteAdapterIdempotencyStore({ db, clock = () => Date.now(), kind = "sqlite-adapter-idempotency" } = {}) {
  if (!db) throw new Error("createSqliteAdapterIdempotencyStore kræver en database");

  const insertStmt = db.prepare(`INSERT INTO adapter_idempotency(
      tenant_id, scope, idempotency_key, request_digest, state, response, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'in-progress', NULL, NULL, ?, ?)`);
  const getStmt = db.prepare("SELECT * FROM adapter_idempotency WHERE tenant_id = ? AND scope = ? AND idempotency_key = ?");
  const completeStmt = db.prepare(`UPDATE adapter_idempotency SET state = 'completed', response = ?, error = NULL, updated_at = ?
    WHERE tenant_id = ? AND scope = ? AND idempotency_key = ?`);
  const failStmt = db.prepare(`UPDATE adapter_idempotency SET state = 'failed', error = ?, updated_at = ?
    WHERE tenant_id = ? AND scope = ? AND idempotency_key = ?`);

  function toRecord(row) {
    if (!row) return null;
    let response = null;
    if (row.response) {
      try {
        response = JSON.parse(row.response);
      } catch {
        response = null;
      }
    }
    return {
      tenantId: row.tenant_id,
      scope: row.scope,
      idempotencyKey: row.idempotency_key,
      requestDigest: row.request_digest,
      state: row.state,
      response,
      error: row.error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function key(tenantId, scope, idempotencyKey) {
    return [normalizeTenantId(tenantId), scope, idempotencyKey];
  }

  return {
    kind,
    digestOf: requestDigest,
    /**
     * Atomisk krav på en nøgle. Returnerer:
     *   `new`       — nøglen er ny og reserveret til dette kald,
     *   `replay`    — samme nøgle + digest, tidligere afsluttet,
     *   `conflict`  — samme nøgle, andet indhold,
     *   `in-flight` — samme nøgle er ved at blive behandlet.
     */
    claim({ tenantId, scope, idempotencyKey, request }) {
      if (!scope) throw new Error("claim kræver en scope");
      if (!idempotencyKey) throw new Error("claim kræver en idempotencyKey");
      const [tenant, sc, keyId] = key(tenantId, scope, idempotencyKey);
      const digest = requestDigest(request ?? {});
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        const existing = getStmt.get(tenant, sc, keyId);
        if (existing) {
          const record = toRecord(existing);
          if (record.requestDigest !== digest) return { status: "conflict", record };
          if (record.state === "completed") return { status: "replay", record };
          if (record.state === "failed") {
            // Et fejlet forsøg må genoptages med samme nøgle og samme indhold.
            db.prepare("UPDATE adapter_idempotency SET state = 'in-progress', error = NULL, updated_at = ? WHERE tenant_id = ? AND scope = ? AND idempotency_key = ?").run(at, tenant, sc, keyId);
            return { status: "new", record: toRecord(getStmt.get(tenant, sc, keyId)) };
          }
          return { status: "in-flight", record };
        }
        insertStmt.run(tenant, sc, keyId, digest, at, at);
        return { status: "new", record: toRecord(getStmt.get(tenant, sc, keyId)) };
      });
    },
    complete({ tenantId, scope, idempotencyKey, response = null, replayable = true }) {
      const [tenant, sc, keyId] = key(tenantId, scope, idempotencyKey);
      const at = new Date(clock()).toISOString();
      const stored = replayable ? (response === undefined ? null : response) : null;
      db.transaction(() => completeStmt.run(stored === null ? null : JSON.stringify(stored), at, tenant, sc, keyId));
      return toRecord(getStmt.get(tenant, sc, keyId));
    },
    fail({ tenantId, scope, idempotencyKey, error = null }) {
      const [tenant, sc, keyId] = key(tenantId, scope, idempotencyKey);
      const at = new Date(clock()).toISOString();
      db.transaction(() => failStmt.run(error, at, tenant, sc, keyId));
      return toRecord(getStmt.get(tenant, sc, keyId));
    },
    get(tenantId, scope, idempotencyKey) {
      const [tenant, sc, keyId] = key(tenantId, scope, idempotencyKey);
      return toRecord(getStmt.get(tenant, sc, keyId));
    },
  };
}
