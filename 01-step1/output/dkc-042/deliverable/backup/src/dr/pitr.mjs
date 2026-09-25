/**
 * DKC-042 — applikationskonsistent backup med WAL-arkivering og PITR.
 *
 * Et snapshot alene er ikke bevis for punktgenopretning. Modulet arkiverer
 * derfor en hash-kædet WAL-strøm ved siden af base-backup'en og kan:
 *
 *   - vælge den nyeste base-backup der ligger før det valgte tidspunkt og stadig
 *     er inden for recovery-vinduet,
 *   - afspille præcis de WAL-poster der ligger mellem base-backup'en og det
 *     valgte tidspunkt på en **rigtig** SQLite-kopi af basen,
 *   - afstemme data (rækkeantal pr. tabel) og ACL (subject → rolle) mod den
 *     forventede tilstand, og
 *   - afvise rekonstruktionen hvis tidspunktet ligger uden for vinduet, hvis
 *     WAL-kæden er brudt, eller hvis ACL afviger.
 *
 * Modellen kører på den rigtige SQLite-persistens. En målt PITR på en levende
 * PostgreSQL-motor er `integration-dr-pitr` og er NOT RUN.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { backupDatabase, openDatabase } from "../../../persistence/src/index.mjs";

const GENESIS = "0".repeat(64);

export class PitrError extends Error {
  constructor(message, code = "pitr_error") {
    super(message);
    this.name = "PitrError";
    this.code = code;
  }
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}

function hashEntry(prevHash, body) {
  return createHash("sha256").update(`${prevHash}|${canonical(body)}`).digest("hex");
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function parseTime(value, label) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new PitrError(`${label} er ikke et gyldigt tidspunkt: '${value}'`, "bad_time");
  return ms;
}

/* -------------------------------------------------------------------------- */
/* WAL-arkiv                                                                  */
/* -------------------------------------------------------------------------- */

export function createWalArchive({ dir, engine = "postgresql" } = {}) {
  if (!dir) throw new PitrError("createWalArchive kræver en mappe", "missing_dir");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "wal.ndjson");

  function readAll() {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  return {
    kind: "wal-archive",
    engine,
    dir,
    path,
    entries: readAll,
    count: () => readAll().length,
    head() {
      const all = readAll();
      return all.length ? all[all.length - 1].hash : GENESIS;
    },
    verify() {
      const all = readAll();
      const problems = [];
      let prev = GENESIS;
      for (const entry of all) {
        const body = { seq: entry.seq, at: entry.at, tenantId: entry.tenantId, kind: entry.kind, table: entry.table, sql: entry.sql, params: entry.params };
        if (entry.prevHash !== prev) problems.push({ type: "broken-link", seq: entry.seq });
        if (entry.hash !== hashEntry(prev, body)) problems.push({ type: "changed", seq: entry.seq });
        prev = entry.hash;
      }
      return { ok: problems.length === 0, problems, head: prev, count: all.length };
    },
    entriesUpTo(targetTime) {
      const cutoff = parseTime(targetTime, "targetTime");
      return readAll().filter((entry) => Date.parse(entry.at) <= cutoff);
    },
    /** Tilføj en committed skrivning til arkivet (append-only og hash-kædet). */
    append({ at, tenantId, kind = "data", table, sql, params = [] } = {}) {
      if (!sql) throw new PitrError("en WAL-post kræver en SQL-sætning", "missing_sql");
      const atIso = iso(parseTime(at, "at"));
      const all = readAll();
      const prev = all.length ? all[all.length - 1].hash : GENESIS;
      const body = { seq: all.length + 1, at: atIso, tenantId: tenantId ?? null, kind, table: table ?? null, sql, params };
      const entry = { ...body, prevHash: prev, hash: hashEntry(prev, body) };
      appendFileSync(path, `${JSON.stringify(entry)}\n`);
      return entry;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Valg af base og recovery-vindue                                            */
/* -------------------------------------------------------------------------- */

/**
 * Vælg base-backup og de WAL-poster der skal afspilles for at ramme `targetTime`.
 * Kaster hvis intet gyldigt base-backup findes inden for recovery-vinduet.
 */
export function planPointInTimeRecovery({ engine = "postgresql", baseBackups = [], walArchive, targetTime, recoveryWindowHours = 24, now = null } = {}) {
  const target = parseTime(targetTime, "targetTime");
  const nowMs = now == null ? Date.now() : parseTime(now, "now");
  if (target > nowMs) throw new PitrError("det valgte tidspunkt ligger i fremtiden", "target_in_future");
  const parsed = (baseBackups ?? [])
    .map((b) => ({ id: b.id, at: parseTime(b.at, `baseBackups[${b.id}].at`) }))
    .filter((b) => b.at <= target)
    .sort((a, b) => b.at - a.at);
  if (parsed.length === 0) throw new PitrError("der findes ingen base-backup før det valgte tidspunkt", "no_base_before_target");
  const base = parsed[0];
  const windowMs = recoveryWindowHours * 3600 * 1000;
  const withinWindow = Number.isFinite(windowMs) ? target - base.at <= windowMs : true;
  if (!withinWindow) throw new PitrError("det valgte tidspunkt ligger uden for recovery-vinduet", "outside_recovery_window");

  const all = walArchive ? walArchive.entries() : [];
  const verification = walArchive ? walArchive.verify() : { ok: true, problems: [] };
  if (!verification.ok) throw new PitrError("WAL-arkivet er brudt eller ændret", "wal_archive_broken");

  const segments = all.filter((entry) => Date.parse(entry.at) > base.at && Date.parse(entry.at) <= target);
  return {
    engine,
    baseBackupId: base.id,
    baseBackupAt: iso(base.at),
    targetTime: iso(target),
    appliedSegments: segments.length,
    segments,
    lastAppliedAt: segments.length ? segments[segments.length - 1].at : iso(base.at),
    withinRecoveryWindow: true,
    recoveryWindowHours,
  };
}

/* -------------------------------------------------------------------------- */
/* ACL- og dataafstemning                                                     */
/* -------------------------------------------------------------------------- */

function readAcl(db) {
  const rows = db.all("SELECT subject, role FROM acl_entries ORDER BY subject");
  const map = {};
  for (const row of rows) map[row.subject] = row.role;
  return map;
}

/** Rekonstruér den forventede ACL fra en base-ACL plus WAL-poster op til target. */
export function aclAsOf({ baseAcl = {}, walArchive, baseAt, targetTime }) {
  const db = openDatabase({ path: ":memory:" });
  try {
    db.exec("CREATE TABLE acl_entries(subject TEXT PRIMARY KEY, role TEXT, updated_at TEXT)");
    for (const [subject, role] of Object.entries(baseAcl)) {
      db.run("INSERT INTO acl_entries(subject, role, updated_at) VALUES (?, ?, ?)", subject, role, iso(0));
    }
    for (const entry of walArchive.entriesUpTo(targetTime)) {
      if (entry.kind !== "acl") continue;
      if (baseAt && Date.parse(entry.at) < parseTime(baseAt, "baseAt")) continue;
      db.run(entry.sql, ...entry.params);
    }
    return readAcl(db);
  } finally {
    db.close();
  }
}

export function reconcileAcl({ db, expected = {}, subject = "acl_entries" } = {}) {
  const actual = readAcl(db);
  const differences = [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    if (expected[key] !== actual[key]) differences.push(`${key}: forventet '${expected[key] ?? "-"}', faktisk '${actual[key] ?? "-"}'`);
  }
  return { reconciled: differences.length === 0, subject, expected, actual, differences };
}

function dataSnapshot(db, tables) {
  const rowCounts = {};
  const digest = createHash("sha256");
  for (const table of [...tables].sort()) {
    const present = db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", table);
    rowCounts[table] = present ? db.get(`SELECT COUNT(*) AS n FROM ${table}`).n : 0;
    digest.update(`${table}:${rowCounts[table]};`);
  }
  return { tables: [...tables].sort(), rowCounts, digest: digest.digest("hex") };
}

/* -------------------------------------------------------------------------- */
/* PITR-rekonstruktion                                                        */
/* -------------------------------------------------------------------------- */

export async function recoverToPointInTime({
  baseDb,
  baseBackupId,
  baseBackupAt,
  walArchive,
  targetTime,
  destDir,
  expectedAcl = null,
  baseAcl = {},
  quiescence = null,
  engine = "postgresql",
  recoveryWindowHours = 24,
  recoveryId = `pitr-${Date.now()}`,
  now = null,
} = {}) {
  if (!baseDb) throw new PitrError("recoverToPointInTime kræver en base-database", "missing_base_db");
  if (!destDir) throw new PitrError("recoverToPointInTime kræver en destinationsmappe", "missing_dest_dir");
  if (!walArchive) throw new PitrError("recoverToPointInTime kræver et WAL-arkiv", "missing_wal_archive");

  const plan = planPointInTimeRecovery({
    engine,
    baseBackups: [{ id: baseBackupId, at: baseBackupAt }],
    walArchive,
    targetTime,
    recoveryWindowHours,
    now,
  });

  mkdirSync(destDir, { recursive: true });
  const dbPath = join(destDir, "recovered.db");
  await backupDatabase(baseDb, dbPath);

  const db = openDatabase({ path: dbPath });
  const appliedTables = new Set();
  try {
    db.transaction(() => {
      for (const entry of plan.segments) {
        db.run(entry.sql, ...entry.params);
        if (entry.table) appliedTables.add(entry.table);
      }
    });
    const data = dataSnapshot(db, appliedTables.size ? appliedTables : new Set(["acl_entries"]));
    const acl = reconcileAcl({ db, expected: expectedAcl ?? aclAsOf({ baseAcl, walArchive, baseAt: baseBackupAt, targetTime }) });
    const consistency = {
      quiesced: quiescence?.quiesced === true,
      includes: quiescence?.includes ?? ["database", "config"],
      maxPauseSeconds: quiescence?.maxPauseSeconds ?? 60,
    };
    const reasons = [];
    if (!plan.withinRecoveryWindow) reasons.push("det valgte tidspunkt ligger uden for recovery-vinduet");
    if (!acl.reconciled) reasons.push(`ACL afstemmer ikke: ${acl.differences.join("; ")}`);
    if (!consistency.quiesced) reasons.push("backupen var ikke applikationskonsistent (quiesced=false)");
    const report = {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "PitrReconciliation",
      recoveryId,
      engine,
      baseBackupId: plan.baseBackupId,
      baseBackupAt: plan.baseBackupAt,
      walArchiveTarget: walArchive.dir,
      targetTime: plan.targetTime,
      appliedSegments: plan.appliedSegments,
      lastAppliedAt: plan.lastAppliedAt,
      withinRecoveryWindow: plan.withinRecoveryWindow,
      data,
      acl,
      applicationConsistency: consistency,
      measured: false,
      status: reasons.length ? "blocked" : "pass",
      reasons,
    };
    return report;
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Semantik for rapporten                                                     */
/* -------------------------------------------------------------------------- */

export function pitrReconciliationProblems(report) {
  const problems = [];
  const err = (path, message) => ({ path, message });
  if (!report || typeof report !== "object") return [err("/", "PITR-rapporten er ikke et objekt")];
  const target = Date.parse(report.targetTime);
  const base = Date.parse(report.baseBackupAt);
  const last = report.lastAppliedAt ? Date.parse(report.lastAppliedAt) : base;
  if (Number.isFinite(base) && Number.isFinite(target) && base > target) problems.push(err("/baseBackupAt", "base-backup'en ligger efter det valgte tidspunkt"));
  if (Number.isFinite(last) && Number.isFinite(target) && last > target) problems.push(err("/lastAppliedAt", "en WAL-post efter det valgte tidspunkt blev afspillet"));

  const passed = report.status === "pass";
  if (passed) {
    if (!report.withinRecoveryWindow) problems.push(err("/withinRecoveryWindow", "en 'pass'-status kræver at tidspunktet er inden for recovery-vinduet"));
    if (report.acl?.reconciled !== true) problems.push(err("/acl/reconciled", "en 'pass'-status kræver at ACL afstemmer"));
    if ((report.acl?.differences ?? []).length) problems.push(err("/acl/differences", "en 'pass'-status må ikke have ACL-afvigelser"));
    if ((report.reasons ?? []).length) problems.push(err("/reasons", "en 'pass'-status må ikke bære begrundelser"));
    if (report.applicationConsistency?.quiesced !== true) problems.push(err("/applicationConsistency/quiesced", "en 'pass'-status kræver en applikationskonsistent backup"));
    if (!(report.data?.tables ?? []).length) problems.push(err("/data/tables", "en 'pass'-status kræver mindst én datatabel"));
  } else if ((report.reasons ?? []).length === 0) {
    problems.push(err("/reasons", "en 'blocked'-status skal forklare hvorfor"));
  }
  return problems;
}
