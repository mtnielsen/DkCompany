/**
 * DKC-040 — holdbar beskedudveksling på tværs af servere.
 *
 * Testene efterprøver den faktiske persistens (SQLite) og den fulde
 * outbox/inbox-protokol:
 *   1. transaktionel outbox (ændring og begivenhed committes/rulles sammen),
 *   2. dedup på idempotency-key,
 *   3. publisher confirms (ingen falsk succes) og fencing af gamle udgivere,
 *   4. inbox-dedup, forsinkede og ombyttede begivenheder og hul-udsættelse,
 *   5. nedbrud efter sideeffekt før ack reconcileres uden blind genudførelse,
 *   6. singleton-lease med monotont fencing-token,
 *   7. synlig backpressure og køsundhed (ingen falsk grøn),
 *   8. tenantafgrænset poison-isolation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../persistence/src/db.mjs";
import { migrateDatabase } from "../../persistence/src/identities.mjs";
import { createMessaging } from "../src/messaging.mjs";
import { buildCloudEvent, eventDigest, assertTenantBound } from "../src/events.mjs";
import { assessBacklog, createQueueHealth } from "../src/health.mjs";

function fixture({ start = Date.parse("2025-09-02T00:00:00Z") } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-messaging-"));
  const db = openDatabase({ path: join(dir, "messaging.db") });
  migrateDatabase(db);
  let now = start;
  const clock = () => now;
  const advance = (ms) => {
    now += ms;
    return now;
  };
  const messaging = createMessaging({ db, clock });
  return { db, dir, messaging, clock, advance, cleanup: () => { try { db.close(); } catch { /* ignore */ } rmSync(dir, { recursive: true, force: true }); } };
}

function eventFor({ id, tenantId = "acme", type = "dk.platform.jobs.job.completed", resourceId = "job-1", version = 1, key = null } = {}) {
  return {
    event: buildCloudEvent({
      tenantId,
      id,
      type,
      source: "platform/jobs",
      resource: { type: "job", id: resourceId, version },
      traceId: "0123456789abcdef0123456789abcdef",
      principal: { kind: "service", id: "svc|jobs-worker" },
      data: { result: { ok: true } },
    }),
    key,
  };
}

test("outbox committer og ruller tilbage sammen med den forretningsmæssige ændring", () => {
  const { db, messaging, cleanup } = fixture();
  try {
    const { event } = eventFor({ id: "evt-1" });
    db.transaction(() => {
      db.run("INSERT INTO jobs(tenant_id, id, kind, payload, status, enqueued_at, updated_at) VALUES ('acme','j1','task','{}','queued','2025-09-02T00:00:00Z','2025-09-02T00:00:00Z')");
      messaging.outbox.append("acme", event);
    });
    assert.equal(messaging.outbox.get("acme", "evt-1").status, "pending");
    assert.ok(db.get("SELECT 1 AS present FROM jobs WHERE id = 'j1'"));

    // Rollback: hverken jobbet eller begivenheden må overleve.
    assert.throws(() => {
      db.transaction(() => {
        db.run("INSERT INTO jobs(tenant_id, id, kind, payload, status, enqueued_at, updated_at) VALUES ('acme','j2','task','{}','queued','2025-09-02T00:00:00Z','2025-09-02T00:00:00Z')");
        messaging.outbox.append("acme", eventFor({ id: "evt-2" }).event);
        throw new Error("forretningsfejl");
      });
    }, /forretningsfejl/);
    assert.equal(messaging.outbox.get("acme", "evt-2"), null);
    assert.equal(db.get("SELECT 1 AS present FROM jobs WHERE id = 'j2'"), undefined);
  } finally {
    cleanup();
  }
});

test("outbox dedupliker på idempotency-key og tenant", () => {
  const { messaging, cleanup } = fixture();
  try {
    const first = messaging.outbox.append("acme", eventFor({ id: "evt-1" }).event, { idempotencyKey: "job-1:completed" });
    assert.equal(first.created, true);
    const second = messaging.outbox.append("acme", eventFor({ id: "evt-1b" }).event, { idempotencyKey: "job-1:completed" });
    assert.equal(second.deduplicated, true);
    assert.equal(second.row.eventId, "evt-1");
    assert.equal(messaging.outbox.list("acme").length, 1);
    // En anden tenant med samme key er en ny begivenhed.
    messaging.outbox.append("globex", eventFor({ id: "evt-2", tenantId: "globex" }).event, { idempotencyKey: "job-1:completed" });
    assert.equal(messaging.outbox.list("globex").length, 1);
  } finally {
    cleanup();
  }
});

test("publisher confirms: en fejlet udgivelse bekræftes ikke og forbliver synlig", async () => {
  const { messaging, advance, cleanup } = fixture();
  try {
    messaging.outbox.append("acme", eventFor({ id: "evt-1" }).event);
    const failing = await messaging.outbox.publishPending("acme", { publisher: async () => { throw new Error("broker unavailable"); } });
    assert.equal(failing[0].confirmed, false);
    assert.equal(messaging.outbox.get("acme", "evt-1").status, "pending");
    assert.equal(messaging.outbox.backlog("acme"), 1);

    advance(2000); // forbi backoff
    const confirming = await messaging.outbox.publishPending("acme", { publisher: async () => {} });
    assert.equal(confirming[0].confirmed, true);
    assert.equal(messaging.outbox.get("acme", "evt-1").status, "confirmed");
    assert.equal(messaging.outbox.backlog("acme"), 0);
  } finally {
    cleanup();
  }
});

test("en gammel udgiver med overtaget lease kan ikke bekræfte (fencing)", () => {
  const { messaging, advance, cleanup } = fixture();
  try {
    messaging.outbox.append("acme", eventFor({ id: "evt-1" }).event);
    const first = messaging.outbox.claimBatch("acme", { workerId: "worker-a", leaseMs: 1000 });
    assert.equal(first[0].leaseToken, 1);
    advance(2000);
    const second = messaging.outbox.claimBatch("acme", { workerId: "worker-b", leaseMs: 1000 });
    assert.equal(second[0].leaseToken, 2);
    assert.equal(messaging.outbox.confirm("acme", "evt-1", { leaseToken: 1 }).ok, false);
    assert.equal(messaging.outbox.confirm("acme", "evt-1", { leaseToken: 2 }).ok, true);
  } finally {
    cleanup();
  }
});

test("inbox dedupliker en genleveret begivenhed uden dobbelt sideeffekt", async () => {
  const { messaging, cleanup } = fixture();
  try {
    const { event } = eventFor({ id: "evt-1" });
    let sideEffects = 0;
    const first = await messaging.inbox.deliver("acme", { consumer: "billing", event, handler: async () => { sideEffects += 1; } });
    assert.equal(first.status, "processed");
    const second = await messaging.inbox.deliver("acme", { consumer: "billing", event, handler: async () => { sideEffects += 1; } });
    assert.equal(second.status, "replayed");
    assert.equal(sideEffects, 1);
    assert.equal(messaging.inbox.list("acme", "billing").length, 1);
  } finally {
    cleanup();
  }
});

test("inbox afviser forsinkede begivenheder og udsætter et hul i versionsrækken", async () => {
  const { messaging, cleanup } = fixture();
  try {
    let handled = 0;
    const v1 = eventFor({ id: "evt-v1", version: 1 }).event;
    const v2 = eventFor({ id: "evt-v2", version: 2 }).event;
    const v0 = eventFor({ id: "evt-v0", version: 0 }).event;

    // Hul: version 2 før version 1 udsættes.
    const deferred = await messaging.inbox.deliver("acme", { consumer: "c", event: v2, handler: async () => { handled += 1; } });
    assert.equal(deferred.status, "deferred");
    assert.equal(deferred.gap, true);
    assert.equal(handled, 0);

    // Version 1 behandles; derefter kan version 2.
    await messaging.inbox.deliver("acme", { consumer: "c", event: v1, handler: async () => { handled += 1; } });
    await messaging.inbox.deliver("acme", { consumer: "c", event: v2, handler: async () => { handled += 1; } });
    assert.equal(handled, 2);

    // En forsinket version 0 (ny event-id) afvises som stale.
    const stale = await messaging.inbox.deliver("acme", { consumer: "c", event: v0, handler: async () => { handled += 1; } });
    assert.equal(stale.status, "skipped");
    assert.equal(stale.skipped, true);
    assert.equal(handled, 2);
  } finally {
    cleanup();
  }
});

test("nedbrud efter sideeffekt før ack reconcileres uden blind genudførelse", async () => {
  const { messaging, cleanup } = fixture();
  try {
    const { event } = eventFor({ id: "evt-1" });
    let sideEffects = 0;
    // Simulér: rækken skrives og markeres processing; workeren dør før ack.
    messaging.inbox.receive("acme", { consumer: "c", event });
    messaging.inbox.begin("acme", { consumer: "c", eventId: "evt-1" });
    sideEffects += 1;

    // En genlevering uden reconciliation må ikke genudføre en uafklaret sag.
    const blind = await messaging.inbox.deliver("acme", { consumer: "c", event, handler: async () => { sideEffects += 1; } });
    assert.equal(blind.status, "dead-letter");
    assert.equal(sideEffects, 1);

    // Med reconciliation afklares den uden ny sideeffekt.
    messaging.inbox.redrive("acme", "c", "evt-1");
    messaging.inbox.begin("acme", { consumer: "c", eventId: "evt-1" });
    const reconciled = await messaging.inbox.deliver("acme", {
      consumer: "c",
      event,
      reconcile: async () => ({ resolved: true, state: "processed" }),
      handler: async () => { sideEffects += 1; },
    });
    assert.equal(reconciled.status, "reconciled");
    assert.equal(sideEffects, 1);
  } finally {
    cleanup();
  }
});

test("singleton-lease: overtagelse hæver fencing-token og ugyldiggør den gamle worker", () => {
  const { messaging, advance, cleanup } = fixture();
  try {
    const first = messaging.singletons.acquire("acme", "backup-scheduler", { holder: "worker-a", leaseMs: 1000 });
    assert.equal(first.acquired, true);
    const tokenA = first.row.fencingToken;
    assert.equal(messaging.singletons.isValid("acme", "backup-scheduler", { holder: "worker-a", fencingToken: tokenA }), true);

    advance(2000);
    const second = messaging.singletons.acquire("acme", "backup-scheduler", { holder: "worker-b", leaseMs: 1000 });
    assert.equal(second.acquired, true);
    assert.equal(second.row.fencingToken, tokenA + 1);
    assert.equal(messaging.singletons.isValid("acme", "backup-scheduler", { holder: "worker-a", fencingToken: tokenA }), false);
    assert.equal(messaging.singletons.heartbeat("acme", "backup-scheduler", { holder: "worker-a", fencingToken: tokenA }), false);
    assert.equal(messaging.singletons.heartbeat("acme", "backup-scheduler", { holder: "worker-b", fencingToken: second.row.fencingToken }), true);
  } finally {
    cleanup();
  }
});

test("backpressure er synlig, og en ulæselig kø giver ikke falsk grøn", () => {
  const { messaging, cleanup } = fixture();
  try {
    assert.equal(messaging.health.snapshot("acme").healthy, true);
    const limited = createQueueHealth({ outbox: messaging.outbox, limits: { maxBacklog: 1, maxAgeMs: 60_000 } });
    messaging.outbox.append("acme", eventFor({ id: "evt-1" }).event);
    messaging.outbox.append("acme", eventFor({ id: "evt-2" }).event);
    const snapshot = limited.snapshot("acme");
    assert.equal(snapshot.healthy, false);
    assert.equal(snapshot.paused, true);
    assert.match(snapshot.reason, /backlog/);

    const broken = createQueueHealth({ outbox: { backlog: () => { throw new Error("db nede"); }, oldestPendingAgeMs: () => 0 } });
    const unknown = broken.snapshot("acme");
    assert.equal(unknown.unknown, true);
    assert.equal(unknown.healthy, false);
  } finally {
    cleanup();
  }
});

test("poison-besked isoleres pr. tenant og blokerer ikke andre kunder", async () => {
  const { messaging, cleanup } = fixture();
  try {
    const poison = eventFor({ id: "evt-poison" }).event;
    messaging.inbox.receive("acme", { consumer: "c", event: poison });
    messaging.inbox.begin("acme", { consumer: "c", eventId: "evt-poison" });
    messaging.inbox.deadLetter("acme", { consumer: "c", event: poison, eventId: "evt-poison", reason: "kan ikke parses" });
    assert.equal(messaging.inbox.deadLetters("acme", "c").length, 1);
    assert.equal(messaging.inbox.deadLetters("globex", "c").length, 0);

    // En anden tenant behandles upåvirket.
    const other = eventFor({ id: "evt-other", tenantId: "globex" }).event;
    const result = await messaging.inbox.deliver("globex", { consumer: "c", event: other, handler: async () => {} });
    assert.equal(result.status, "processed");
  } finally {
    cleanup();
  }
});

test("en begivenhed bundet til en anden tenant afvises", () => {
  const { messaging, cleanup } = fixture();
  try {
    const foreign = eventFor({ id: "evt-x", tenantId: "globex" }).event;
    assert.throws(() => assertTenantBound(foreign, "acme"), /anden tenant/);
    assert.throws(() => messaging.outbox.append("acme", foreign), /anden tenant/);
  } finally {
    cleanup();
  }
});

test("event-digest er stabil og ændrer sig ved indholdsændring", () => {
  const { event } = eventFor({ id: "evt-1" });
  assert.equal(eventDigest(event), eventDigest(event));
  const tampered = { ...event, data: { ...event.data, result: { ok: false } } };
  assert.notEqual(eventDigest(event), eventDigest(tampered));
});

test("assessBacklog markerer overgrænse og sundhed", () => {
  assert.equal(assessBacklog({ backlog: 1, oldestAgeMs: 10, maxBacklog: 10, maxAgeMs: 100 }).healthy, true);
  assert.equal(assessBacklog({ backlog: 11, oldestAgeMs: 10, maxBacklog: 10, maxAgeMs: 100 }).paused, true);
  assert.equal(assessBacklog({ backlog: 1, oldestAgeMs: 101, maxBacklog: 10, maxAgeMs: 100 }).paused, true);
});
