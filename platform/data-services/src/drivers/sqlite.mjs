/**
 * DKC-056 — indbygget SQLite-driver.
 *
 * Platformens indbyggede database til lokal udvikling og til den administrerede
 * profils teststi. Driveren eksponerer samme interface som PostgreSQL-driveren,
 * så den samme applikationskode kan køre mod begge.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { QueryError } from "../errors.mjs";

const READ_STATEMENT = /^\s*(select|with|pragma|explain)\b/i;

/** Oversæt '$1..$n' til '?' så applikations-SQL er dialectsymmetrisk. */
function normalizePlaceholders(sql) {
  return sql.replace(/\$(\d+)/g, "?");
}

export function createSqliteDriver(config = {}) {
  const { path = ":memory:", readOnly = false } = config;
  let db = null;

  function requireDb() {
    if (!db) throw new QueryError("sqlite-driveren er ikke forbundet");
    return db;
  }

  return {
    kind: "sqlite",

    async connect() {
      if (path !== ":memory:" && !readOnly) mkdirSync(dirname(path), { recursive: true });
      db = new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: true });
      if (!readOnly) {
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA synchronous = NORMAL");
      }
      return { engine: "sqlite", version: process.versions.node, tls: { enabled: false, mode: "disable" }, parameters: {} };
    },

    async query(sql, params = []) {
      const database = requireDb();
      const text = normalizePlaceholders(sql);
      try {
        if (READ_STATEMENT.test(text)) {
          const statement = database.prepare(text);
          const rows = statement.all(...params.map(coerce));
          const columns = statement.columns().map((c) => ({ name: c.name, dataTypeID: c.type }));
          return { columns, rows, rowCount: rows.length, command: { tag: "SELECT", detail: `SELECT ${rows.length}`, count: rows.length } };
        }
        const result = database.prepare(text).run(...params.map(coerce));
        return { columns: [], rows: [], rowCount: result.changes, command: { tag: text.trim().split(/\s+/)[0].toUpperCase(), detail: "", count: result.changes } };
      } catch (err) {
        throw new QueryError(`sqlite-forespørgsel fejlede: ${err.message}`, { cause: err });
      }
    },

    async discoverSchema({ schemas = [] } = {}) {
      const database = requireDb();
      const allowed = new Set(schemas);
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all();
      const result = [];
      for (const { name } of tables) {
        const columns = database.prepare("SELECT name, type FROM pragma_table_info(?)").all(name).map((c) => ({ name: c.name, type: c.type }));
        result.push({ name, columns });
      }
      const schemaName = "main";
      if (allowed.size && !allowed.has(schemaName)) return { schemas: [] };
      return { schemas: [{ name: schemaName, tables: result }] };
    },

    async close() {
      if (db) {
        db.close();
        db = null;
      }
    },
  };
}

function coerce(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}
