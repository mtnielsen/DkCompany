/**
 * DKC-049 — holdbar auditkvittering før mutation.
 *
 * `recordMutation` er den ene vej til en muterende AI- eller serverhandling:
 *
 *   1. den strukturerede intent-post skrives til den holdbare, hash-kædede
 *      log (ledgeren) og — for klasser der kræver det — WORM-arkiveres,
 *   2. den minimale, to-fasede auditkvittering skrives og committes (DKC-009),
 *   3. FØRST derefter udføres mutationen,
 *   4. outcome skrives bundet til samme idempotency-ID.
 *
 * Fejler trin 1 eller 2, kastes der, og mutationen udføres **ikke**. Et
 * logsvigt kan derfor ikke give en ulogget mutation. Et crash mellem 2 og 3
 * efterlader et `pending`-intent, som skal reconciliere — ikke genudføres
 * ukritisk.
 */
import { buildLogRecord, approvalDigestOf } from "./record.mjs";
import { requiresImmutableArchive } from "./policy.mjs";
import { buildCorrelation } from "./correlation.mjs";
import { digest } from "./canonical.mjs";

export class ReceiptError extends Error {
  constructor(message, code = "receipt_error") {
    super(message);
    this.name = "ReceiptError";
    this.code = code;
  }
}

function makeCorrelation(input) {
  if (input?.correlationId && input?.executionId) return buildCorrelation(input);
  throw new ReceiptError("mutationen kræver correlationId og executionId", "missing_correlation");
}

export function createMutationRecorder({ ledger, journal, archive = null, policy = null, clock = () => Date.now() } = {}) {
  if (!ledger || typeof ledger.append !== "function") throw new ReceiptError("createMutationRecorder kræver en ledger", "missing_ledger");
  if (!journal || typeof journal.begin !== "function") throw new ReceiptError("createMutationRecorder kræver en action-journal", "missing_journal");

  return {
    kind: "mutation-recorder",

    /**
     * Udfør en muterende handling med holdbar kvittering og fuld logning.
     * @param {Function} params.mutation  Den faktiske mutation; kaldes kun når kvitteringen er holdbar.
     */
    async recordMutation({
      tenantId,
      idempotencyId,
      verb,
      target,
      correlation,
      request = {},
      service = "runtime",
      environment = "dev",
      resource = target,
      dataClassification = "operational",
      retentionClass = "operational",
      tool = null,
      policyRef = null,
      policyDigest = null,
      approvalDigest = null,
      runbookDigest = null,
      before = null,
      after = null,
      retry = 0,
      fallback = null,
      artifactDigest = null,
      mutation,
    } = {}) {
      if (!idempotencyId) throw new ReceiptError("mangler idempotencyId", "missing_idempotency");
      if (typeof mutation !== "function") throw new ReceiptError("mangler mutation-funktion", "missing_mutation");
      const corr = makeCorrelation(correlation);
      const occurredAt = new Date(clock()).toISOString();

      // 1) Struktureret intent + (for beskyttede klasser) WORM-arkiv FØR mutation.
      const intentRecord = buildLogRecord(
        {
          occurredAt,
          correlation: corr,
          scope: { tenantId, environment, service, resource },
          provenance: "system",
          observation: { source: `intent:${verb}`, freshness: "fresh", value: { request } },
          action: {
            mutating: true,
            ...(tool ? { tool } : {}),
            ...(policyRef ? { policy: policyRef } : {}),
            ...(policyDigest ? { policyDigest } : {}),
            ...(approvalDigest ? { approvalDigest } : {}),
            ...(runbookDigest ? { runbookDigest } : {}),
            before,
            after,
            retry,
            fallback,
          },
          receipt: { intentId: "pending", idempotencyId, state: "pending", auditEventId: null, anchored: false },
          dataClassification,
          retentionClass,
        },
        { policy }
      );
      const storedIntent = await ledger.append(intentRecord);

      let archiveSummary = null;
      if (archive && requiresImmutableArchive(policy, retentionClass)) {
        archiveSummary = await archive.archive(storedIntent.record);
      }

      // 2) Holdbar, to-faset auditkvittering. Fejler den, udføres mutationen ikke.
      let begun;
      try {
        begun = await journal.begin({ tenantId, idempotencyId, verb, target, environment, request });
      } catch (err) {
        throw new ReceiptError(`kunne ikke skrive holdbar auditkvittering: ${err.message}`, "receipt_failed");
      }
      if (begun?.duplicate && begun.state && begun.state !== "pending") {
        return { duplicate: true, state: begun.state, intent: storedIntent.record, outcome: begun.outcome ?? null };
      }

      // 3) Mutationen.
      let result = null;
      let error = null;
      let outcome = "succeeded";
      try {
        result = await mutation();
      } catch (err) {
        outcome = "failed";
        error = err.message;
      }

      // 4) Outcome bundet til samme idempotency-ID.
      let completed;
      try {
        completed = await journal.complete({ tenantId, idempotencyId, outcome, result, error });
      } catch (err) {
        completed = { ok: false, state: "unknown", error: err.message };
      }

      const outcomeRecord = buildLogRecord(
        {
          occurredAt: new Date(clock()).toISOString(),
          correlation: { ...corr, parentId: storedIntent.record.id },
          scope: { tenantId, environment, service, resource },
          provenance: "verified",
          verification: {
            verifier: "platform.runtime",
            method: `mutation-outcome:${verb}`,
            artifactDigest: artifactDigest ?? digest({ outcome, result, error }),
            result: outcome === "succeeded" ? "pass" : "fail",
            verifiedAt: new Date(clock()).toISOString(),
          },
          action: { mutating: false, ...(tool ? { tool } : {}), retry, fallback },
          receipt: {
            intentId: storedIntent.record.receipt?.intentId ?? begun?.intent?.intentId ?? "unknown",
            idempotencyId,
            state: outcome,
            auditEventId: completed?.auditEventId ?? null,
            hash: completed?.hash ?? null,
            anchored: Boolean(begun?.anchor),
          },
          dataClassification,
          retentionClass,
        },
        { policy }
      );
      const storedOutcome = await ledger.append(outcomeRecord);

      if (error) {
        const failure = new ReceiptError(`mutation '${verb}' fejlede: ${error}`, "mutation_failed");
        failure.intent = storedIntent.record;
        failure.outcome = storedOutcome.record;
        throw failure;
      }
      return { result, intent: storedIntent.record, outcome: storedOutcome.record, receipt: completed, archive: archiveSummary };
    },
  };
}

export { approvalDigestOf };
