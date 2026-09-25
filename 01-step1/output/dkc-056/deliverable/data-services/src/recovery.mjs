/**
 * DKC-056 — backup og gendannelse for datatjenester.
 *
 * Backup er en logisk, verificerbar snapshot af de tabeller platformen ejer.
 * Gendannelse sker til en ren database, og digesten kontrolleres, så en muteret
 * snapshot ikke kan indlæses som gyldig.
 *
 * Eksterne kilder er ikke platformens egne databaser: de må ikke
 * sikkerhedskopieres automatisk uden en eksplicit scope-aftale.
 */
import { createHash } from "node:crypto";
import { BackupScopeError } from "./errors.mjs";

export function digestRows(rows) {
  return createHash("sha256").update(canonicalJson(rows)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Afvis backup af en ekstern kilde uden en eksplicit scope-aftale. */
export function assertBackupAllowed(target, { scopeAgreementRef = null } = {}) {
  const external = target?.externalPolicy != null || target?.kind === "DataSource";
  if (!external) return { allowed: true, reason: "managed-profile" };
  const agreement = scopeAgreementRef ?? target.externalPolicy?.scopeAgreementRef ?? null;
  if (target.externalPolicy?.autoBackup === true && agreement) {
    return { allowed: true, reason: "explicit-scope-agreement", agreement };
  }
  throw new BackupScopeError(
    `den eksterne kilde '${target?.metadata?.name ?? "?"}' må ikke sikkerhedskopieres automatisk uden en eksplicit scope-aftale`
  );
}

/** Logisk backup af en tabel gennem et repository med exportRows/importRows. */
export function createRecovery({ store, clock = () => Date.now() } = {}) {
  if (!store) throw new Error("createRecovery kræver et store");

  return {
    async backup({ profile = null } = {}) {
      if (profile && profile.backup?.enabled !== true) {
        throw new BackupScopeError(`profilen '${profile.metadata?.name ?? "?"}' har ikke backup slået til`);
      }
      const rows = await store.exportRows();
      const snapshot = { at: new Date(clock()).toISOString(), table: store.table ?? "app_notes", rowCount: rows.length, rows };
      snapshot.digest = digestRows(rows);
      return snapshot;
    },

    async restore(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.rows)) throw new BackupScopeError("snapshot mangler rækker");
      if (snapshot.digest && snapshot.digest !== digestRows(snapshot.rows)) {
        throw new BackupScopeError("snapshot-digesten matcher ikke indholdet; gendannelsen afvises");
      }
      await store.removeAll();
      await store.importRows(snapshot.rows);
      return { restored: snapshot.rows.length, digest: snapshot.digest ?? digestRows(snapshot.rows) };
    },

    async verifyRestore(snapshot) {
      const before = [...snapshot.rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const restored = (await store.exportRows()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const ok = digestRows(before) === digestRows(restored);
      return { ok, expected: before.length, actual: restored.length, digest: digestRows(restored) };
    },
  };
}
