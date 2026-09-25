/**
 * DKC-008 — versionsstyrede databasemigrationer.
 *
 * Migrations er rene `.sql`-filer i `persistence/migrations/` med navnet
 * `NNNN_beskrivelse.sql`. De anvendes i nummerorden, én ad gangen, i en
 * transaktion, og hver anvendt migration registreres med sin SHA-256 i
 * `schema_migrations`. Dermed:
 *   - er et tidligere schema reproducerbart (samme filer → samme schema),
 *   - opdages en efterfølgende ændring af en allerede anvendt migration,
 *   - kan et opgraderingsforløb afbrydes uden at efterlade et halvt schema.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const NAME_RE = /^(\d{4})_([a-z0-9_-]+)\.sql$/;

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationError";
  }
}

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

/** Læs og validér alle migrationer fra en mappe. */
export function discoverMigrations(dir = migrationsDir) {
  if (!existsSync(dir)) throw new MigrationError(`migrationsmappen findes ikke: ${dir}`);
  const migrations = [];
  const seen = new Set();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const match = NAME_RE.exec(file);
    if (!match) throw new MigrationError(`ugyldigt migrationsnavn '${file}' (forventet NNNN_navn.sql)`);
    const version = Number(match[1]);
    if (seen.has(version)) throw new MigrationError(`dubleret migrationsversion ${version}`);
    seen.add(version);
    const sql = readFileSync(join(dir, file), "utf8");
    migrations.push({ version, name: match[2], file, sql, checksum: checksum(sql) });
  }
  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

/**
 * Migration-runner. `db` er en wrapper fra `openDatabase`.
 */
export function createMigrator({ db, dir = migrationsDir } = {}) {
  if (!db) throw new MigrationError("createMigrator kræver en database");

  function ensureTable() {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
  }

  function applied() {
    ensureTable();
    return db.all("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version");
  }

  function currentVersion() {
    const rows = applied();
    return rows.length ? rows[rows.length - 1].version : 0;
  }

  /** Bekræft at ingen anvendt migration er ændret efter den blev anvendt. */
  function verifyChecksums(migrations = discoverMigrations(dir)) {
    const byVersion = new Map(migrations.map((m) => [m.version, m]));
    const problems = [];
    for (const row of applied()) {
      const known = byVersion.get(row.version);
      if (!known) {
        problems.push({ version: row.version, problem: "anvendt migration findes ikke længere" });
      } else if (known.checksum !== row.checksum) {
        problems.push({ version: row.version, problem: "anvendt migration er ændret efter den blev anvendt" });
      }
    }
    return problems;
  }

  function plan({ toVersion = Infinity, migrations = discoverMigrations(dir) } = {}) {
    const done = new Set(applied().map((r) => r.version));
    return migrations.filter((m) => !done.has(m.version) && m.version <= toVersion);
  }

  /**
   * Anvend ventende migrationer. Returnerer listen af anvendte versioner.
   * `dryRun` rapporterer kun planen (til `make persistence-check`).
   */
  function apply({ toVersion = Infinity, dryRun = false, now = () => new Date().toISOString() } = {}) {
    const migrations = discoverMigrations(dir);
    const problems = verifyChecksums(migrations);
    if (problems.length) {
      throw new MigrationError(`schema-historik er ændret: ${problems.map((p) => `v${p.version} (${p.problem})`).join(", ")}`);
    }
    const pending = plan({ toVersion, migrations });
    if (dryRun) return { applied: [], pending, current: currentVersion() };
    const appliedNow = [];
    for (const migration of pending) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
          migration.version,
          migration.name,
          migration.checksum,
          now()
        );
      });
      appliedNow.push(migration.version);
    }
    return { applied: appliedNow, pending: [], current: currentVersion() };
  }

  function status() {
    const migrations = discoverMigrations(dir);
    const done = new Set(applied().map((r) => r.version));
    return {
      current: currentVersion(),
      applied: [...done].sort((a, b) => a - b),
      pending: migrations.filter((m) => !done.has(m.version)).map((m) => ({ version: m.version, name: m.name })),
      latest: migrations.length ? migrations[migrations.length - 1].version : 0,
      problems: verifyChecksums(migrations),
    };
  }

  return { ensureTable, applied, currentVersion, plan, apply, status, verifyChecksums, dir };
}
