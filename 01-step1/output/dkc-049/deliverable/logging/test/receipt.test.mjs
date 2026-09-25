import { test } from "node:test";
import assert from "node:assert/strict";
import { createMutationRecorder, ReceiptError } from "../src/receipt.mjs";
import { makeLedger, makeCorrelation, POLICY } from "./support/fixture.mjs";

function memoryJournal(overrides = {}) {
  const intents = new Map();
  const events = [];
  return {
    events,
    async begin(input) {
      if (overrides.begin) return overrides.begin(input);
      if (intents.has(input.idempotencyId)) {
        return { ok: false, duplicate: true, state: intents.get(input.idempotencyId).state, intent: intents.get(input.idempotencyId) };
      }
      intents.set(input.idempotencyId, { state: "pending", ...input });
      events.push({ phase: "intent", ...input });
      return { ok: true, duplicate: false, state: "pending", intent: { intentId: `i-${input.idempotencyId}`, ...input }, auditEventId: "evt-intent", hash: "a".repeat(64), anchor: { anchoredAt: new Date().toISOString() } };
    },
    async complete(input) {
      if (overrides.complete) return overrides.complete(input);
      const intent = intents.get(input.idempotencyId);
      intent.state = input.outcome;
      events.push({ phase: "outcome", ...input });
      return { ok: true, state: input.outcome, auditEventId: "evt-outcome", hash: "b".repeat(64) };
    },
  };
}

function baseMutation(overrides = {}) {
  return {
    tenantId: "acme",
    idempotencyId: "idem-1",
    verb: "scale",
    target: "res://acme/deployment/checkout-api",
    correlation: makeCorrelation(),
    retentionClass: "operational",
    mutation: async () => ({ replicas: 4 }),
    ...overrides,
  };
}

test("udfører mutationen og skriver intent + outcome i lederen", async () => {
  const { ledger } = makeLedger();
  const journal = memoryJournal();
  const recorder = createMutationRecorder({ ledger, journal, policy: POLICY });
  let mutated = false;
  const result = await recorder.recordMutation(baseMutation({ mutation: async () => { mutated = true; return { replicas: 4 }; } }));
  assert.equal(mutated, true);
  assert.deepEqual(result.result, { replicas: 4 });
  const records = await ledger.read({ tenantId: "acme" });
  assert.equal(records.length, 2);
  assert.equal(records[0].provenance, "system");
  assert.equal(records[1].provenance, "verified");
  assert.equal(records[1].verification.result, "pass");
});

test("et journalfejl giver ingen mutation (fail-closed)", async () => {
  const { ledger } = makeLedger();
  const journal = memoryJournal({ begin: async () => { throw new Error("audit utilgængelig"); } });
  const recorder = createMutationRecorder({ ledger, journal, policy: POLICY });
  let mutated = false;
  await assert.rejects(
    () => recorder.recordMutation(baseMutation({ mutation: async () => { mutated = true; } })),
    (err) => err instanceof ReceiptError
  );
  assert.equal(mutated, false);
  // Intenten er skrevet, men der er ingen outcome.
  const records = await ledger.read({ tenantId: "acme" });
  assert.equal(records.length, 1);
  assert.equal(records[0].provenance, "system");
});

test("et logfejl giver ingen mutation (fail-closed)", async () => {
  const journal = memoryJournal();
  const recorder = createMutationRecorder({ ledger: { append: async () => { throw new Error("log utilgængelig"); } }, journal, policy: POLICY });
  let mutated = false;
  await assert.rejects(() => recorder.recordMutation(baseMutation({ mutation: async () => { mutated = true; } })), /log utilgængelig/);
  assert.equal(mutated, false);
});

test("en allerede afsluttet idempotency-key genudføres ikke", async () => {
  const { ledger } = makeLedger();
  const journal = memoryJournal({ begin: async () => ({ ok: false, duplicate: true, state: "succeeded", outcome: { replicas: 4 } }) });
  const recorder = createMutationRecorder({ ledger, journal, policy: POLICY });
  let mutated = false;
  const result = await recorder.recordMutation(baseMutation({ mutation: async () => { mutated = true; } }));
  assert.equal(mutated, false);
  assert.equal(result.duplicate, true);
  assert.equal(result.state, "succeeded");
});

test("en personhenførbar mutation arkiveres til WORM FØR udførelse", async () => {
  const { ledger } = makeLedger();
  const journal = memoryJournal();
  const archived = [];
  const archive = { archive: async (record) => { archived.push(record); return { worm: true, targets: [] }; } };
  const recorder = createMutationRecorder({ ledger, journal, archive, policy: POLICY });
  await recorder.recordMutation(baseMutation({ retentionClass: "personal" }));
  assert.equal(archived.length, 1);
  assert.equal(archived[0].retentionClass, "personal");
});

test("fejler arkiveringen, udføres mutationen ikke", async () => {
  const { ledger } = makeLedger();
  const journal = memoryJournal();
  const archive = { archive: async () => { throw new Error("WORM utilgængeligt"); } };
  const recorder = createMutationRecorder({ ledger, journal, archive, policy: POLICY });
  let mutated = false;
  await assert.rejects(() => recorder.recordMutation(baseMutation({ retentionClass: "personal", mutation: async () => { mutated = true; } })), /WORM utilgængeligt/);
  assert.equal(mutated, false);
});
