/**
 * DKC-010 — holdbar nødstop-tilstand.
 *
 * Implementerer den `store`-grænseflade `credentials/src/kill-switch.mjs`
 * bruger: `setClock`, `put`, `get(scope, subjectId)`, `all`. Tilstanden deles
 * mellem processer/noder gennem databasen, så et aktivt nødstop slår igennem
 * overalt inden for kill-switchens cachegrænse (≤ 5 s).
 */
function parse(row) {
  if (!row) return null;
  return {
    scope: row.scope,
    subjectId: row.subject_id === "*" ? null : row.subject_id,
    active: row.active === 1,
    reason: row.reason,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at,
    clearedBy: row.cleared_by,
    clearedAt: row.cleared_at,
  };
}

export function createSqliteStopStore({ db, clock = () => Date.now(), kind = "sqlite-stop-store" } = {}) {
  if (!db) throw new Error("createSqliteStopStore kræver en database");

  const putStmt = db.prepare(`INSERT INTO kill_switches(scope, subject_id, active, reason, activated_by, activated_at, cleared_by, cleared_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, subject_id) DO UPDATE SET active = excluded.active, reason = excluded.reason,
      activated_by = excluded.activated_by, activated_at = excluded.activated_at,
      cleared_by = excluded.cleared_by, cleared_at = excluded.cleared_at`);
  const getStmt = db.prepare("SELECT * FROM kill_switches WHERE scope = ? AND subject_id = ?");
  const allStmt = db.prepare("SELECT * FROM kill_switches ORDER BY activated_at");

  const key = (scope, subjectId) => String(subjectId ?? "*");

  return {
    kind,
    setClock() {
      /* uret er delt med kill-switchen; DB'en har brug for det ikke */
    },
    put(record) {
      db.transaction(() => {
        putStmt.run(record.scope, key(record.scope, record.subjectId), record.active ? 1 : 0, record.reason ?? null, record.activatedBy ?? null, record.activatedAt ?? null, record.clearedBy ?? null, record.clearedAt ?? null);
      });
      return record;
    },
    get(scope, subjectId) {
      return parse(getStmt.get(scope, key(scope, subjectId)));
    },
    all() {
      return allStmt.all().map(parse);
    },
  };
}
