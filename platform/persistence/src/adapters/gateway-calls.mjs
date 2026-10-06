/**
 * DKC-012 — holdbar idempotens og afregningskvittering for modelgatewayen.
 *
 * Hvert modelkald har en `(tenant, idempotency_key)`. Den første kalder vinder
 * kravet atomisk; en gentaget request med samme nøgle og samme request-digest
 * får den gemte kvittering uden at kalde leverandøren igen og uden at forbruge
 * budgettet to gange. Samme nøgle med et andet indhold afvises som konflikt.
 *
 * Rå modeltekst gemmes kun for dataklasser uden personhenførbare data. For
 * personhenførbare klasser gemmes alene metadata + digest, så idempotens kan
 * genkendes uden at loggen bliver et personregister.
 */
import { createHash } from "node:crypto";
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";

/** Dataklasser hvor selve modelteksten potentielt indeholder persondata. */
const PERSONAL_DATA_CLASSES = new Set(["personal", "special-category", "sensitive-personal", "pseudonymised"]);

function digestOf(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function createSqliteGatewayCallStore({ db, clock = () => Date.now(), kind = "sqlite-gateway-call-store" } = {}) {
  if (!db) throw new Error("createSqliteGatewayCallStore kræver en database");

  const insertStmt = db.prepare(`INSERT INTO gateway_calls(
      tenant_id, idempotency_key, request_digest, state, route_id, provider, model, model_version, data_class, tokens, cost_eur, reservation_id, response, created_at, updated_at)
    VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?)`);
  const getStmt = db.prepare("SELECT * FROM gateway_calls WHERE tenant_id = ? AND idempotency_key = ?");
  const settleStmt = db.prepare(`UPDATE gateway_calls SET
      state = 'settled', tokens = ?, cost_eur = ?, response = ?, updated_at = ?
    WHERE tenant_id = ? AND idempotency_key = ?`);
  const releaseStmt = db.prepare(`UPDATE gateway_calls SET
      state = 'released', tokens = ?, cost_eur = ?, updated_at = ?
    WHERE tenant_id = ? AND idempotency_key = ?`);

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
      idempotencyKey: row.idempotency_key,
      requestDigest: row.request_digest,
      state: row.state,
      routeId: row.route_id,
      provider: row.provider,
      model: row.model,
      modelVersion: row.model_version,
      dataClass: row.data_class,
      tokens: row.tokens,
      costEur: row.cost_eur,
      reservationId: row.reservation_id ?? null,
      response,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    kind,
    /** Request-digest som kalderen kan bruge til konfliktkontrol. */
    digestOf,
    /**
     * Atomisk krav på en idempotency-nøgle. Returnerer:
     *   `{ status: "new" }`      — nøglen er ny og reserveret til dette kald,
     *   `{ status: "replay" }`   — samme nøgle + samme digest, tidligere afsluttet,
     *   `{ status: "conflict" }` — samme nøgle, andet indhold,
     *   `{ status: "in-flight" }`— samme nøgle er ved at blive behandlet.
     */
    claim({ tenantId, idempotencyKey, requestDigest, route, dataClass }) {
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        const existing = getStmt.get(tenant, idempotencyKey);
        if (existing) {
          const record = toRecord(existing);
          if (record.requestDigest !== requestDigest) {
            return { status: "conflict", record };
          }
          if (record.state === "settled") return { status: "replay", record };
          if (record.state === "released") {
            // Et frigivet kald (timeout/fejl) kan genoptages med samme nøgle og
            // samme indhold; kravet genaktiveres atomisk.
            db.prepare("UPDATE gateway_calls SET state = 'reserved', response = NULL, tokens = 0, cost_eur = 0, updated_at = ? WHERE tenant_id = ? AND idempotency_key = ?").run(at, tenant, idempotencyKey);
            return { status: "new", record: toRecord(getStmt.get(tenant, idempotencyKey)) };
          }
          return { status: "in-flight", record };
        }
        insertStmt.run(tenant, idempotencyKey, requestDigest, route?.id ?? null, route?.provider ?? null, route?.model ?? null, route?.modelVersion ?? null, dataClass ?? null, null, at, at);
        return { status: "new", record: toRecord(getStmt.get(tenant, idempotencyKey)) };
      });
    },
    attachReservation({ tenantId, idempotencyKey, reservationId }) {
      const tenant = normalizeTenantId(tenantId);
      db.transaction(() => db.prepare("UPDATE gateway_calls SET reservation_id = ?, updated_at = ? WHERE tenant_id = ? AND idempotency_key = ?").run(reservationId, new Date(clock()).toISOString(), tenant, idempotencyKey));
    },
    /**
     * Afslut kaldet. `response` gemmes kun for ikke-personhenførbare klasser;
     * ellers gemmes metadata, og teksten udelades bevidst.
     */
    settle({ tenantId, idempotencyKey, tokens = 0, costEur = 0, response = null, dataClass = null }) {
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      const safeResponse = PERSONAL_DATA_CLASSES.has(String(dataClass).toLowerCase()) ? null : response;
      return db.transaction(() => {
        settleStmt.run(tokens, costEur, safeResponse ? JSON.stringify(safeResponse) : null, at, tenant, idempotencyKey);
        return { ok: true, record: toRecord(getStmt.get(tenant, idempotencyKey)) };
      });
    },
    release({ tenantId, idempotencyKey, tokens = 0, costEur = 0 }) {
      const tenant = normalizeTenantId(tenantId);
      const at = new Date(clock()).toISOString();
      return db.transaction(() => {
        releaseStmt.run(tokens, costEur, at, tenant, idempotencyKey);
        return { ok: true, record: toRecord(getStmt.get(tenant, idempotencyKey)) };
      });
    },
    get(tenantId, idempotencyKey) {
      return toRecord(getStmt.get(normalizeTenantId(tenantId), idempotencyKey));
    },
  };
}
