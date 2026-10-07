/**
 * DKC-008 — child-process worker til samtidighedstest.
 *
 * Hver worker åbner den samme databasefil som de øvrige og udfører en lille,
 * afgrænset skriveoperation. Brugen af separate processer beviser at
 * serialiseringen sker i databasen (WAL + `BEGIN IMMEDIATE`), ikke i én delt
 * proces' hukommelse.
 *
 *   node fixtures/persistence-worker.mjs <mode> <dbPath> <tenant> <antal> [extra]
 */
import { openDatabase } from "../src/db.mjs";
import { createSqliteAuditLog } from "../src/adapters/audit.mjs";
import { createSqliteBudgetStore } from "../src/adapters/budgets.mjs";
import { createSqliteApprovalStore } from "../src/adapters/approvals.mjs";
import { createSqliteJobStore } from "../src/adapters/jobs.mjs";

const [mode, dbPath, tenant, countArg, extra] = process.argv.slice(2);
const count = Number(countArg ?? 1);
const db = openDatabase({ path: dbPath, busyTimeoutMs: 10_000 });

try {
  if (mode === "audit-append") {
    const audit = createSqliteAuditLog({ db });
    for (let i = 0; i < count; i++) audit.append({ tenantId: tenant, type: "worker.event", payload: { i, pid: process.pid } });
    console.log(JSON.stringify({ mode, appended: count, size: audit.size(tenant) }));
  } else if (mode === "budget-consume") {
    const budgets = createSqliteBudgetStore({ db });
    budgets.setCeiling(tenant, "agent", Number(extra ?? 1000));
    let ok = 0;
    for (let i = 0; i < count; i++) {
      if (budgets.consume(tenant, "agent", { tokens: 1 }).ok) ok++;
    }
    console.log(JSON.stringify({ mode, ok }));
  } else if (mode === "approval-claim") {
    const store = createSqliteApprovalStore({ db });
    const won = store.claim(extra, { tenantId: tenant, executionId: `worker-${process.pid}` });
    console.log(JSON.stringify({ mode, won }));
  } else if (mode === "job-lease") {
    const jobs = createSqliteJobStore({ db });
    let leased = 0;
    for (;;) {
      const job = jobs.lease(tenant, `worker-${process.pid}`);
      if (!job) break;
      jobs.complete(tenant, job.id, { worker: process.pid });
      leased++;
    }
    console.log(JSON.stringify({ mode, leased }));
  } else {
    throw new Error(`ukendt mode: ${mode}`);
  }
  db.close();
} catch (err) {
  console.error(JSON.stringify({ mode, error: err.message }));
  try {
    db.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
