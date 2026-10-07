/**
 * DKC-008 — holdbar beslutningslog for godkendelser.
 *
 * Samme kontrakt som `approvals/src/ledger.mjs` (append-only hash-kæde, valgfri
 * HMAC), men rækkerne ligger i databasen og skrives i en `BEGIN IMMEDIATE`-
 * transaktion. En brudt kæde ved indlæsning er en hård fejl (fail-closed), så et
 * genstart ikke kan skjule en efterfølgende ændring.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function createSqliteApprovalLedger({ db, secret = null, genesis = "0".repeat(64), kind = "sqlite-approval-ledger" } = {}) {
  if (!db) throw new Error("createSqliteApprovalLedger kræver en database");

  const entries = [];
  let lastHash = genesis;

  function digestFor(prevHash, entry) {
    const data = `${prevHash}|${canonical(entry)}`;
    return secret ? createHmac("sha256", secret).update(data).digest("hex") : createHash("sha256").update(data).digest("hex");
  }

  // Indlæs og verificér den eksisterende log ved start.
  for (const row of db.all("SELECT * FROM approval_ledger ORDER BY seq ASC")) {
    const entry = {
      seq: row.seq,
      id: row.id,
      type: row.type,
      at: row.at,
      tenantId: row.tenant_id,
      state: row.state,
      bindingDigest: row.binding_digest,
      actor: row.actor,
      detail: row.detail === null ? null : JSON.parse(row.detail),
      prevHash: row.prev_hash,
    };
    if (entry.seq !== entries.length + 1 || entry.prevHash !== lastHash || digestFor(lastHash, entry) !== row.hash) {
      const err = new Error(`audit-log er brudt ved seq ${row.seq}`);
      err.code = "AUDIT_CHAIN_BROKEN";
      throw err;
    }
    entries.push({ ...entry, hash: row.hash });
    lastHash = row.hash;
  }

  const insertStmt = db.prepare(`INSERT INTO approval_ledger(id, type, at, tenant_id, state, binding_digest, actor, detail, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  return {
    kind,
    genesis,
    path: null,
    entries,
    append(input) {
      return db.transaction(() => {
        const entry = {
          seq: entries.length + 1,
          id: input.id,
          type: input.type,
          at: input.at ?? new Date().toISOString(),
          tenantId: input.tenantId ?? null,
          state: input.state ?? null,
          bindingDigest: input.bindingDigest ?? null,
          actor: input.actor ?? null,
          detail: input.detail ?? null,
          prevHash: lastHash,
        };
        const hash = digestFor(lastHash, entry);
        insertStmt.run(entry.id, entry.type, entry.at, entry.tenantId, entry.state, entry.bindingDigest, entry.actor, JSON.stringify(entry.detail), entry.prevHash, hash);
        const stored = { ...entry, hash };
        entries.push(stored);
        lastHash = hash;
        return stored;
      });
    },
    verifyChain() {
      let prev = genesis;
      for (const entry of entries) {
        const { hash, ...rest } = entry;
        if (digestFor(prev, rest) !== hash) return { ok: false, brokenAt: entry.seq, length: entries.length };
        prev = hash;
      }
      return { ok: true, length: entries.length };
    },
    get lastHash() {
      return lastHash;
    },
    newId: randomUUID,
  };
}
