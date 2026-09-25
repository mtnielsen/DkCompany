/**
 * DKC-008 — holdbar tilstand: database-wrapper oven på `node:sqlite`.
 *
 * Wrapperen giver præcis de egenskaber resten af persistenslaget har brug for:
 *   - en rigtig filbaseret (eller in-memory) SQLite-database,
 *   - WAL + `busy_timeout`, så flere processer/replikaer kan læse samtidigt og
 *     skrive uden at miste data,
 *   - eksplicitte transaktioner (`BEGIN IMMEDIATE`) med rollback ved fejl,
 *   - en per-forbindelse tenant-kontekst og tenant-filtrerede views, så en
 *     forkert tenant ikke kan læse en andens rækker gennem databaseadgangen.
 *
 * Modulet er bevidst tyndt: al domænelogik ligger i adapterne under
 * `persistence/src/adapters/`.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** De tabeller der findes i baseline-skemaet, og de views der afgrænser dem. */
export const TENANT_TABLES = {
  approval_requests: "v_approval_requests",
  approval_claims: "v_approval_claims",
  jobs: "v_jobs",
  budgets: "v_budgets",
  audit_events: "v_audit_events",
  audit_intents: "v_audit_intents",
  audit_personal: "v_audit_personal",
};

function tableExists(raw, name) {
  const row = raw.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row?.present);
}

/**
 * Åbn en database. `readOnly` åbner en skrivebeskyttet forbindelse (bruges af
 * rapporteringsidentiteten); skrivning afvises af SQLite selv.
 */
export function openDatabase({ path = ":memory:", readOnly = false, busyTimeoutMs = 5000, foreignKeys = true } = {}) {
  if (path !== ":memory:" && !readOnly) mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: foreignKeys });
  raw.exec(`PRAGMA busy_timeout = ${Number(busyTimeoutMs) || 0}`);
  if (foreignKeys) raw.exec("PRAGMA foreign_keys = ON");
  if (!readOnly) {
    // WAL: læsere blokeres ikke af den skrivende, og committede skrivninger
    // overlever et procesnedbrud. `synchronous=NORMAL` er den anbefalede,
    // holdbare kombination med WAL.
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA synchronous = NORMAL");
  }

  let depth = 0;

  /**
   * Kør `fn` i en transaktion. `BEGIN IMMEDIATE` tager skrivelåsen med det
   * samme, så to samtidige skrivere serialiseres i stedet for at fejle sent.
   * Indlejrede kald bruger savepoints.
   */
  function transaction(fn, { immediate = true } = {}) {
    const nested = depth > 0;
    const name = `dkc_sp_${depth}`;
    if (nested) raw.exec(`SAVEPOINT ${name}`);
    else raw.exec(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
    depth++;
    try {
      const result = fn();
      if (nested) raw.exec(`RELEASE ${name}`);
      else raw.exec("COMMIT");
      depth--;
      return result;
    } catch (err) {
      try {
        if (nested) {
          raw.exec(`ROLLBACK TO ${name}`);
          raw.exec(`RELEASE ${name}`);
        } else {
          raw.exec("ROLLBACK");
        }
      } catch {
        /* rollback kan fejle hvis transaktionen allerede er afsluttet */
      }
      depth--;
      throw err;
    }
  }

  const db = {
    kind: "sqlite",
    raw,
    path,
    readOnly,
    exec(sql) {
      return raw.exec(sql);
    },
    prepare(sql) {
      return raw.prepare(sql);
    },
    run(sql, ...params) {
      return raw.prepare(sql).run(...params);
    },
    get(sql, ...params) {
      return raw.prepare(sql).get(...params);
    },
    all(sql, ...params) {
      return raw.prepare(sql).all(...params);
    },
    transaction,
    close() {
      raw.close();
    },
    /** Sæt den tenant denne forbindelse må se gennem tenant-viewene. */
    setTenant(tenantId) {
      db.installTenantViews();
      raw.prepare("INSERT INTO session_context(id, tenant_id) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET tenant_id = excluded.tenant_id").run(tenantId ?? null);
      return tenantId ?? null;
    },
    /**
     * Opret per-forbindelses tenant-kontekst og -views (idempotent). Kaldes
     * både ved åbning og ved `setTenant`, så views først oprettes når
     * migrationerne har lavet tabellerne.
     */
    installTenantViews() {
      raw.exec("CREATE TEMP TABLE IF NOT EXISTS session_context(id INTEGER PRIMARY KEY CHECK(id = 1), tenant_id TEXT)");
      raw.exec("INSERT OR IGNORE INTO session_context(id, tenant_id) VALUES(1, NULL)");
      for (const [table, view] of Object.entries(TENANT_TABLES)) {
        if (!tableExists(raw, table)) continue;
        raw.exec(`CREATE TEMP VIEW IF NOT EXISTS ${view} AS SELECT * FROM ${table} WHERE tenant_id = (SELECT tenant_id FROM session_context WHERE id = 1)`);
      }
    },
  };

  db.installTenantViews();
  return db;
}
