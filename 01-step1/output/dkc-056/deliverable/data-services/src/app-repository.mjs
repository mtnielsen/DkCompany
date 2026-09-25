/**
 * DKC-056 — den applikation, der kører mod både den indbyggede og den eksterne
 * database.
 *
 * Repositoriet bruger kun dialectsymmetrisk SQL (`?`-pladsholdere), så præcis
 * samme kode og præcis samme kontrakt- og recoverytest kører mod SQLite og
 * PostgreSQL. Det er beviset for, at applikationen ikke er bundet til én motor.
 */
export function createNotesRepository(driver, { table = "app_notes", clock = () => Date.now() } = {}) {
  if (!driver) throw new Error("createNotesRepository kræver en driver");

  return {
    table,

    async migrate() {
      await driver.query(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
    },
    async create({ id, body, createdAt = null }) {
      const at = createdAt ?? new Date(clock()).toISOString();
      await driver.query(`INSERT INTO ${table} (id, body, created_at) VALUES (?, ?, ?)`, [id, body, at]);
      return { id, body, created_at: at };
    },
    async get(id) {
      const { rows } = await driver.query(`SELECT id, body, created_at FROM ${table} WHERE id = ?`, [id]);
      return rows[0] ?? null;
    },
    async list() {
      const { rows } = await driver.query(`SELECT id, body, created_at FROM ${table} ORDER BY created_at, id`);
      return rows;
    },
    async count() {
      const { rows } = await driver.query(`SELECT COUNT(*) AS c FROM ${table}`);
      return Number(rows[0]?.c ?? 0);
    },
    async removeAll() {
      await driver.query(`DELETE FROM ${table}`);
    },
    async drop() {
      await driver.query(`DROP TABLE IF EXISTS ${table}`);
    },
    async exportRows() {
      return this.list();
    },
    async importRows(rows) {
      for (const row of rows) {
        await this.create({ id: row.id, body: row.body, createdAt: row.created_at ?? row.createdAt });
      }
    },
  };
}
