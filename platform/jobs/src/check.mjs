#!/usr/bin/env node
/**
 * DKC-013 — `make jobs-check`.
 *
 * Fokuseret, deterministisk kontrol af den genoptagelige jobkø uden en levende
 * worker:
 *   - v5-migrationen findes, og forsøgs-/dead-letter-tabellerne er der,
 *   - verbumsklassifikationen skelner read, reversibel og irreversibel,
 *   - tilstandsmaskinen afviser ulovlige overgange,
 *   - samme idempotency-key opretter kun ét job,
 *   - leases bruger fencing-token, og en udløbet lease kan genåbnes,
 *   - begrænsede forsøg udmønter sig i retry eller dead-letter, og et
 *     dead-letter-job kan genindlæses,
 *   - forsøgssporet er sporbart, og tenanten er isoleret.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../persistence/src/db.mjs";
import { migrateDatabase } from "../../persistence/src/identities.mjs";
import { createJobQueue } from "./queue.mjs";
import { DEFAULT_RETRY_POLICY, decideOutcome, isRetryableError } from "./retry.mjs";
import { allowedTransitions, assertTransition, canTransition } from "./state.mjs";
import { classifyVerb, compensationFor } from "./classification.mjs";

const errors = [];
const notes = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

// 1) Klassifikation.
check(classifyVerb("observe.read") === "read", "observe.read skulle være read");
check(classifyVerb("restart") === "reversible-write", "restart skulle være reversible-write");
check(classifyVerb("upgrade.patch") === "irreversible-write", "upgrade.patch skulle være irreversible-write");
check(classifyVerb("upgrade.export-unknown") === "irreversible-write", "et ukendt muterende verbum skulle være irreversible-write (fail-safe)");
check(compensationFor("upgrade.patch") === "rollback", "upgrade.patch skulle kompenseres med rollback");
check(compensationFor("subject.erase") === null, "subject.erase har ingen kompensation");
notes.push("3 handlingsklasser og kompensationskort");

// 2) Tilstandsmaskine.
check(canTransition("queued", "leased"), "queued → leased skulle være tilladt");
check(canTransition("leased", "queued"), "en udløbet lease skulle kunne genåbnes");
check(!canTransition("completed", "running"), "completed → running må ikke være tilladt");
check(!canTransition("dead-letter", "running"), "dead-letter → running må ikke være tilladt");
check(allowedTransitions("running").includes("unknown"), "running → unknown mangler");
let rejected = false;
try {
  assertTransition("completed", "running");
} catch {
  rejected = true;
}
check(rejected, "assertTransition skulle afvise completed → running");
notes.push("jobtilstandsmaskine med terminale tilstande");

// 3) Retry-beslutning.
check(isRetryableError(new Error("ECONNRESET")) === true, "ECONNRESET skulle være forbigående");
check(isRetryableError(new Error("ugyldig signatur")) === false, "en permanent fejl skulle ikke være forbigående");
check(decideOutcome({ classification: "irreversible-write", state: "unknown", attempt: 1, maxAttempts: 3 }).action === "escalate", "irreversibelt unknown skulle eskaleres");
check(decideOutcome({ classification: "reversible-write", state: "failed", attempt: 1, maxAttempts: 3, retryable: true }).action === "retry", "en forbigående reversibel fejl skulle gentages");
check(decideOutcome({ classification: "reversible-write", state: "failed", attempt: 3, maxAttempts: 3, retryable: true }).action === "dead-letter", "forsøgsgrænsen skulle give dead-letter");
check(decideOutcome({ classification: "read", state: "failed", attempt: 1, maxAttempts: 3, retryable: false }).action === "dead-letter", "en permanent fejl skulle i dead-letter");
notes.push(`retry-politik (max ${DEFAULT_RETRY_POLICY.maxAttempts} forsøg)`);

// 4) Holdbar kø.
const dir = mkdtempSync(join(tmpdir(), "dkc-jobs-check-"));
try {
  const db = openDatabase({ path: join(dir, "runtime.db") });
  migrateDatabase(db);
  check(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'job_attempts'"), "job_attempts mangler");
  check(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'job_dead_letters'"), "job_dead_letters mangler");
  check(db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'jobs'"), "jobs mangler");

  let now = Date.parse("2025-09-02T00:00:00Z");
  const queue = createJobQueue({ db, clock: () => now });

  const first = queue.submit("acme", { id: "job-1", kind: "task", idempotencyKey: "idem-1", payload: { task: { actions: [{ verb: "restart" }] } } });
  check(first.created === true, "det første job skulle oprettes");
  const second = queue.submit("acme", { id: "job-2", kind: "task", idempotencyKey: "idem-1", payload: { task: { actions: [{ verb: "restart" }] } } });
  check(second.deduplicated === true, "samme idempotency-key skulle deduplikeres");
  check(second.job.id === "job-1", "dedup skulle returnere det eksisterende job");
  check(queue.list("acme").length === 1, "der skulle kun være ét job");
  check(queue.list("globex").length === 0, "tenant-isolation: globex må ikke se acme's job");

  const leased = queue.lease("acme", "worker-a");
  check(leased.id === "job-1" && leased.status === "leased", "jobbet skulle leases");
  check(leased.lease_token === 1, "lease_token skulle være 1");
  check(queue.heartbeat("acme", "job-1", 999) === false, "et forkert fencing-token må ikke forlænge lease");
  check(queue.heartbeat("acme", "job-1", leased.lease_token) === true, "det rigtige fencing-token skulle forlænge lease");
  check(queue.lease("acme", "worker-b") === null, "et leaset job må ikke leases igen");

  queue.beginAttempt("acme", "job-1", { attempt: leased.attempts, classification: "reversible-write", leaseToken: leased.lease_token });
  queue.succeed("acme", "job-1", { attempt: leased.attempts, result: { ok: true }, executionId: "exec-1" });
  const attempts = queue.attempts("acme", "job-1");
  check(attempts.length === 1 && attempts[0].executionId === "exec-1", "forsøgssporet skulle være sporbart");
  check(queue.get("acme", "job-1").status === "completed", "jobbet skulle være completed");

  // Fejl → retry → dead-letter → redrive.
  queue.submit("acme", { id: "job-fail", kind: "task", idempotencyKey: "idem-fail", payload: { task: { actions: [{ verb: "restart" }] } }, maxAttempts: 2 });
  const leasedFail = queue.lease("acme", "worker-a");
  queue.beginAttempt("acme", "job-fail", { attempt: leasedFail.attempts, classification: "reversible-write", leaseToken: leasedFail.lease_token });
  const retry = queue.fail("acme", "job-fail", { attempt: leasedFail.attempts, classification: "reversible-write", error: new Error("ECONNRESET") });
  check(retry.status === "retry-scheduled", "en forbigående fejl skulle give retry");
  now += retry.delayMs + 1;
  const leasedRetry = queue.lease("acme", "worker-a");
  check(leasedRetry.id === "job-fail", "retry-jobbet skulle leases igen efter backoff");
  queue.beginAttempt("acme", "job-fail", { attempt: leasedRetry.attempts, classification: "reversible-write", leaseToken: leasedRetry.lease_token });
  const dead = queue.fail("acme", "job-fail", { attempt: leasedRetry.attempts, classification: "reversible-write", error: new Error("ECONNRESET") });
  check(dead.status === "dead-letter", "forsøgsgrænsen skulle give dead-letter");
  check(queue.deadLetters("acme").length === 1, "dead-letter-køen skulle have ét job");
  const redriven = queue.redrive("acme", "job-fail");
  check(redriven.status === "queued" && redriven.attempts === 0, "redrive skulle nulstille forsøgene");

  // Udløbet lease genåbnes.
  const leasedStale = queue.lease("acme", "worker-a");
  now += 120_000;
  const reopened = queue.recoverStaleLeases({ olderThanMs: 60_000, now });
  check(reopened.some((j) => j.id === leasedStale.id), "en udløbet lease skulle genåbnes");

  const tenants = db.all("SELECT DISTINCT tenant_id FROM jobs").map((r) => r.tenant_id);
  check(!tenants.includes("globex"), "globex må ikke have rækker i jobs");
  db.close();
  notes.push("kø, idempotens, leases, retry, dead-letter og redrive");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (errors.length) {
  console.error("✘ Jobkontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Jobkontrol bestået (${notes.join("; ")})`);
console.log("✔ Genoptagelig, idempotent jobkørsel med leases, retries og dead-letter verificeret");
