/**
 * DKC-008 — samtidige writes bevarer konsistens.
 *
 * Der startes flere rigtige OS-processer mod samme databasefil. Det beviser at
 * serialiseringen ligger i databasen (WAL + `BEGIN IMMEDIATE`), ikke i én delt
 * proces. Efter løbet kontrolleres det at:
 *   - audit-kæden har præcis det forventede antal poster og verificerer,
 *   - budgettet aldrig overstiger loftet,
 *   - kun én worker vandt reservationen,
 *   - intet job blev udført to gange.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { migrateDatabase } from "../src/identities.mjs";
import { createSqliteAuditLog } from "../src/adapters/audit.mjs";
import { createSqliteBudgetStore } from "../src/adapters/budgets.mjs";
import { createSqliteApprovalStore } from "../src/adapters/approvals.mjs";
import { createSqliteJobStore } from "../src/adapters/jobs.mjs";

const WORKER = fileURLToPath(new URL("../fixtures/persistence-worker.mjs", import.meta.url));

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", WORKER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`worker ${args.join(" ")} fejlede (${code}): ${err || out}`));
      try {
        resolve(JSON.parse(out.trim()));
      } catch (parseErr) {
        reject(new Error(`ugyldigt worker-output: ${out}`));
      }
    });
  });
}

function fixture(name) {
  const dir = mkdtempSync(join(tmpdir(), `dkc-persist-conc-${name}-`));
  const dbPath = join(dir, "state.db");
  const db = openDatabase({ path: dbPath });
  migrateDatabase(db);
  return { dir, dbPath, db, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

test("parallelle audit-skrivninger giver én konsistent hash-kæde", async () => {
  const { db, dbPath, cleanup } = fixture("audit");
  try {
    const workers = 4;
    const perWorker = 25;
    const results = await Promise.all(
      Array.from({ length: workers }, () => runWorker(["audit-append", dbPath, "acme", String(perWorker)]))
    );
    assert.equal(results.reduce((n, r) => n + r.appended, 0), workers * perWorker);
    const audit = createSqliteAuditLog({ db });
    assert.equal(audit.size("acme"), workers * perWorker);
    assert.equal(audit.verifyChain("acme").ok, true);
    assert.equal(audit.size("globex"), 0);
  } finally {
    cleanup();
  }
});

test("parallelt budgetforbrug overskrider ikke loftet", async () => {
  const { db, dbPath, cleanup } = fixture("budget");
  try {
    const workers = 6;
    const perWorker = 40;
    const ceiling = 100;
    const results = await Promise.all(
      Array.from({ length: workers }, () => runWorker(["budget-consume", dbPath, "acme", String(perWorker), String(ceiling)]))
    );
    const consumed = results.reduce((n, r) => n + r.ok, 0);
    assert.ok(consumed <= ceiling, `forbrug ${consumed} må ikke overstige loftet ${ceiling}`);
    const budgets = createSqliteBudgetStore({ db });
    assert.equal(budgets.get("acme", "agent").tokens, consumed);
  } finally {
    cleanup();
  }
});

test("kun én worker kan reservere samme godkendelse", async () => {
  const { db, dbPath, cleanup } = fixture("claim");
  try {
    const store = createSqliteApprovalStore({ db });
    store.save({ id: "req-1", tenantId: "acme", decision: { state: "approved" } });

    const results = await Promise.all(Array.from({ length: 8 }, () => runWorker(["approval-claim", dbPath, "acme", "1", "req-1"])));
    const winners = results.filter((r) => r.won);
    assert.equal(winners.length, 1, "præcis én worker må vinde reservationen");
  } finally {
    cleanup();
  }
});

test("parallelle workers udfører hvert job præcis én gang", async () => {
  const { db, dbPath, cleanup } = fixture("jobs");
  try {
    const jobs = createSqliteJobStore({ db });
    const expected = 30;
    for (let i = 0; i < expected; i++) jobs.enqueue("acme", { id: `job-${i}` });

    const results = await Promise.all(Array.from({ length: 5 }, () => runWorker(["job-lease", dbPath, "acme", "1"])));
    const totalLeased = results.reduce((n, r) => n + r.leased, 0);
    assert.equal(totalLeased, expected, "ingen job må leases eller udføres to gange");
    assert.equal(jobs.list("acme", { status: "completed" }).length, expected);
    assert.equal(jobs.list("acme", { status: "queued" }).length, 0);
  } finally {
    cleanup();
  }
});
