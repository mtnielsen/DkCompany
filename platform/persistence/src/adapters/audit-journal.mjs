/**
 * DKC-009 — holdbar action-journal med intent/outcome og idempotens.
 *
 * Protokollen er bevidst to-faset og fail-closed:
 *
 *   1. `begin()` skriver og committer et **intent** (med idempotency-ID) til
 *      databasen FØR nogen ekstern ændring. Først når kvitteringen er holdbar,
 *      må kalderen udføre handlingen. Er audit-loggen utilgængelig, kaster
 *      `begin()` — og der sker ingen ekstern ændring.
 *   2. `complete()` skriver **outcome** bundet til samme idempotency-ID.
 *
 * Et nedbrud mellem 1 og 2 efterlader intentet i `pending`. On genkørsel ser
 * `begin()` det eksisterende intent og returnerer `{ duplicate: true }` i
 * stedet for at udføre igen; state er `unknown` indtil `reconcile()` afgør den
 * faktiske udfald (fx ved at spørge den eksterne ressource). Dermed kan et
 * crash hverken give et falsk success eller en ukritisk genudførelse.
 *
 * Personhenførbare payloads gemmes i `audit_personal` med egen retention, og
 * hemmeligheder fjernes af `prepareAuditPayload` før noget skrives.
 */
import { randomUUID } from "node:crypto";
import { normalizeTenantId } from "../../../identity/src/tenant.mjs";
import { payloadDigestOf, prepareAuditPayload } from "../redact.mjs";

const FINAL_STATES = new Set(["succeeded", "failed"]);

export class JournalError extends Error {
  constructor(message, code = "JOURNAL_ERROR") {
    super(message);
    this.name = "JournalError";
    this.code = code;
  }
}

export function createSqliteActionJournal({
  db,
  audit,
  checkpoint = null,
  clock = () => Date.now(),
  kind = "sqlite-action-journal",
  personalRetentionDays = 30,
  operationalRetentionDays = 365,
} = {}) {
  if (!db) throw new Error("createSqliteActionJournal kræver en database");
  if (!audit) throw new Error("createSqliteActionJournal kræver en audit-log");

  const getIntentStmt = db.prepare("SELECT * FROM audit_intents WHERE tenant_id = ? AND idempotency_id = ?");
  const insertIntentStmt = db.prepare(`INSERT INTO audit_intents(
      tenant_id, idempotency_id, intent_id, verb, target, environment, actor, request_digest, state, created_at, updated_at, outcome_at, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, 0)`);
  const updateStateStmt = db.prepare(`UPDATE audit_intents SET state = ?, updated_at = ?, outcome_at = ?, attempts = attempts + 1
    WHERE tenant_id = ? AND idempotency_id = ?`);
  const listStateStmt = db.prepare("SELECT * FROM audit_intents WHERE tenant_id = ? AND state = ? ORDER BY created_at, idempotency_id");
  const unresolvedStmt = db.prepare("SELECT * FROM audit_intents WHERE state IN ('pending', 'unknown') ORDER BY created_at, tenant_id, idempotency_id");
  const insertPersonalStmt = db.prepare(`INSERT OR IGNORE INTO audit_personal(tenant_id, digest, subject_key, categories, payload, created_at, retain_until, erased_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`);
  const getPersonalStmt = db.prepare("SELECT * FROM audit_personal WHERE tenant_id = ? AND digest = ?");
  const eraseExpiredStmt = db.prepare(`UPDATE audit_personal SET payload = '{}', erased_at = ?, subject_key = NULL
    WHERE erased_at IS NULL AND retain_until IS NOT NULL AND retain_until < ?`);

  const retentionFor = (retentionClass) => (retentionClass === "personal" ? personalRetentionDays : operationalRetentionDays);
  const iso = (ms) => new Date(ms).toISOString();

  function parseIntent(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      idempotencyId: row.idempotency_id,
      intentId: row.intent_id,
      verb: row.verb,
      target: row.target,
      environment: row.environment,
      actor: row.actor,
      requestDigest: row.request_digest,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      outcomeAt: row.outcome_at,
      attempts: row.attempts,
    };
  }

  function storePersonal(tenantId, prepared, at) {
    if (prepared.personal === null || prepared.personalDigest === null) return;
    const subjectKey = prepared.personal.email ?? prepared.personal.subject ?? prepared.personal.subjectId ?? null;
    const retainUntil = iso(clock() + retentionFor("personal") * 86_400_000);
    insertPersonalStmt.run(tenantId ?? null, prepared.personalDigest, subjectKey, JSON.stringify(prepared.categories), JSON.stringify(prepared.personal), at, retainUntil);
  }

  function maybeAnchor(tenantId) {
    if (!checkpoint) return null;
    try {
      return checkpoint.anchor({ tenantId });
    } catch (err) {
      throw new JournalError(`kunne ikke forankre checkpoint: ${err.message}`, "CHECKPOINT_FAILED");
    }
  }

  function intentEvents(tenantId, idempotencyId) {
    return audit.byIdempotencyId(tenantId ?? null, idempotencyId);
  }

  const journal = {
    kind,

    /**
     * Skriv den vedvarende intent og returnér kvitteringen. Kalderen MÅ ikke
     * udføre den eksterne ændring før denne funktion er returneret uden fejl.
     */
    begin({ tenantId = null, idempotencyId, verb, target, environment = null, actor = null, request = {}, dataCategories = [], retentionClass = null } = {}) {
      if (!idempotencyId) throw new JournalError("begin kræver et idempotencyId", "MISSING_IDEMPOTENCY");
      if (!verb || !target) throw new JournalError("begin kræver verb og target", "MISSING_ACTION");
      const tenant = tenantId === null ? null : normalizeTenantId(tenantId);
      const prepared = prepareAuditPayload({ payload: request, dataCategories, retentionClass });
      const requestDigest = payloadDigestOf({ operational: prepared.operational, personal: prepared.personalDigest });

      const result = db.transaction(() => {
        const existing = parseIntent(getIntentStmt.get(tenant, idempotencyId));
        if (existing) {
          const events = intentEvents(tenant, idempotencyId);
          const outcomeEvent = events.find((e) => e.phase === "outcome") ?? null;
          return {
            ok: false,
            duplicate: true,
            state: existing.state,
            reconciliation: existing.state === "pending" ? "unknown" : existing.state,
            intent: existing,
            intentEvent: events.find((e) => e.phase === "intent") ?? null,
            outcomeEvent,
            outcome: outcomeEvent?.payload ?? null,
          };
        }

        const intentId = randomUUID();
        const at = iso(clock());
        insertIntentStmt.run(tenant, idempotencyId, intentId, verb, target, environment, actor, requestDigest, at, at);
        storePersonal(tenant, prepared, at);
        const event = audit.append({
          tenantId: tenant,
          at,
          type: `${verb}.intent`,
          verb,
          actor,
          phase: "intent",
          outcome: null,
          idempotencyId,
          intentId,
          payload: prepared.operational,
          payloadDigest: prepared.payloadDigest,
          personalDataDigest: prepared.personalDigest,
          retentionClass: prepared.retentionClass,
        });
        return {
          ok: true,
          duplicate: false,
          state: "pending",
          intent: parseIntent(getIntentStmt.get(tenant, idempotencyId)),
          receipt: { intentId, idempotencyId, state: "pending", auditEventId: event.id, hash: event.hash, at },
          auditEventId: event.id,
          hash: event.hash,
          redactions: prepared.redactions,
        };
      });

      if (result.ok) result.anchor = maybeAnchor(tenant);
      return result;
    },

    /** Skriv outcome for et tidligere intent. Idempotent: gentages ikke. */
    complete({ tenantId = null, idempotencyId, outcome = "succeeded", result = null, error = null, dataCategories = [] } = {}) {
      if (!idempotencyId) throw new JournalError("complete kræver et idempotencyId", "MISSING_IDEMPOTENCY");
      if (!["succeeded", "failed", "unknown"].includes(outcome)) throw new JournalError(`ukendt outcome '${outcome}'`, "BAD_OUTCOME");
      const tenant = tenantId === null ? null : normalizeTenantId(tenantId);
      const prepared = prepareAuditPayload({ payload: { result, error }, dataCategories });

      const response = db.transaction(() => {
        const intent = parseIntent(getIntentStmt.get(tenant, idempotencyId));
        if (!intent) throw new JournalError(`intent '${idempotencyId}' findes ikke`, "UNKNOWN_INTENT");
        if (FINAL_STATES.has(intent.state) || intent.state === "unknown") {
          const events = intentEvents(tenant, idempotencyId);
          const outcomeEvent = events.find((e) => e.phase === "outcome") ?? null;
          return { ok: true, duplicate: true, state: intent.state, intent, outcomeEvent, outcome: outcomeEvent?.payload ?? null };
        }
        const at = iso(clock());
        updateStateStmt.run(outcome, at, at, tenant, idempotencyId);
        storePersonal(tenant, prepared, at);
        const event = audit.append({
          tenantId: tenant,
          at,
          type: `${intent.verb}.outcome`,
          verb: intent.verb,
          actor: intent.actor,
          phase: "outcome",
          outcome,
          idempotencyId,
          intentId: intent.intentId,
          payload: prepared.operational,
          payloadDigest: prepared.payloadDigest,
          personalDataDigest: prepared.personalDigest,
          retentionClass: prepared.retentionClass,
        });
        return { ok: true, duplicate: false, state: outcome, intent: parseIntent(getIntentStmt.get(tenant, idempotencyId)), outcomeEvent: event, auditEventId: event.id, hash: event.hash };
      });

      response.anchor = maybeAnchor(tenant);
      return response;
    },

    /**
     * Markér et intent som `unknown` efter et crash. Der udføres intet; den
     * eksterne sandhed skal afgøres via en reconciliation.
     */
    markUnknown({ tenantId = null, idempotencyId, reason = "crash mellem intent og outcome" } = {}) {
      const tenant = tenantId === null ? null : normalizeTenantId(tenantId);
      return db.transaction(() => {
        const intent = parseIntent(getIntentStmt.get(tenant, idempotencyId));
        if (!intent) throw new JournalError(`intent '${idempotencyId}' findes ikke`, "UNKNOWN_INTENT");
        if (intent.state !== "pending") return { ok: true, duplicate: true, state: intent.state, intent };
        const at = iso(clock());
        updateStateStmt.run("unknown", at, null, tenant, idempotencyId);
        const event = audit.append({ tenantId: tenant, at, type: "action.unknown", verb: intent.verb, actor: intent.actor, phase: "outcome", outcome: "unknown", idempotencyId, intentId: intent.intentId, payload: { reason }, retentionClass: "operational" });
        return { ok: true, duplicate: false, state: "unknown", intent: parseIntent(getIntentStmt.get(tenant, idempotencyId)), auditEventId: event.id };
      });
    },

    /**
     * Reconcile et `pending`/`unknown` intent. `resolve` er en funktion der
     * undersøger den eksterne ressource og returnerer `{ outcome, result }`.
     * Uden en resolver markeres intentet blot `unknown` — der genudføres intet.
     */
    reconcile({ tenantId = null, idempotencyId, resolve = null } = {}) {
      const tenant = tenantId === null ? null : normalizeTenantId(tenantId);
      const found = journal.lookup({ tenantId: tenant, idempotencyId });
      if (!found.found) return { ok: false, reason: "not-found", idempotencyId };
      if (found.state === "succeeded" || found.state === "failed") return { ok: true, alreadyResolved: true, state: found.state, outcome: found.outcome };
      if (!resolve) {
        const marked = journal.markUnknown({ tenantId: tenant, idempotencyId });
        return { ok: true, resolved: false, state: "unknown", intent: marked.intent };
      }
      const verdict = resolve(found.intent);
      if (!verdict || !verdict.outcome) {
        const marked = journal.markUnknown({ tenantId: tenant, idempotencyId, reason: "reconciliation kunne ikke afgøre udfaldet" });
        return { ok: true, resolved: false, state: "unknown", intent: marked.intent };
      }
      const completed = journal.complete({ tenantId: tenant, idempotencyId, outcome: verdict.outcome, result: verdict.result ?? null, error: verdict.error ?? null });
      return { ok: true, resolved: true, state: completed.state, outcome: completed.outcome };
    },

    lookup({ tenantId = null, idempotencyId } = {}) {
      const tenant = tenantId === null ? null : normalizeTenantId(tenantId);
      const intent = parseIntent(getIntentStmt.get(tenant, idempotencyId));
      const events = intentEvents(tenant, idempotencyId);
      const outcomeEvent = events.find((e) => e.phase === "outcome") ?? null;
      return {
        found: Boolean(intent),
        state: intent?.state ?? null,
        intent,
        outcome: outcomeEvent?.payload ?? null,
        events,
      };
    },

    /** Alle intents i en given tilstand (fx 'pending'/'unknown') for en tenant. */
    listByState(tenantId, state) {
      return listStateStmt.all(normalizeTenantId(tenantId), state).map(parseIntent);
    },

    /** Alle uafklarede intents på tværs af tenants (til reconciliation ved opstart). */
    unresolved() {
      return unresolvedStmt.all().map(parseIntent);
    },

    readPersonal({ tenantId, digest } = {}) {
      const row = getPersonalStmt.get(normalizeTenantId(tenantId), digest);
      if (!row) return null;
      return { tenantId: row.tenant_id, digest: row.digest, subjectKey: row.subject_key, categories: JSON.parse(row.categories), payload: row.payload === "{}" ? null : JSON.parse(row.payload), createdAt: row.created_at, retainUntil: row.retain_until, erasedAt: row.erased_at };
    },

    /** Slet udløbet persondata uden at røre den hash-kædede log. */
    eraseExpiredPersonal({ now = clock() } = {}) {
      const at = iso(now);
      const changes = eraseExpiredStmt.run(at, at).changes;
      return { erased: changes };
    },

    /** Konsistenskontrol: intents, outcome-begivenheder og hash-kæden. */
    verify(tenantId = null) {
      const problems = [];
      const chain = audit.verifyChain(tenantId);
      if (!chain.ok) problems.push({ type: "chain", detail: `hash-kæden er brudt ved ${chain.brokenAt}`, brokenAt: chain.brokenAt });
      const events = audit.events(tenantId);
      const byIdem = new Map();
      for (const event of events) {
        if (!event.idempotencyId) continue;
        const list = byIdem.get(event.idempotencyId) ?? [];
        list.push(event);
        byIdem.set(event.idempotencyId, list);
      }
      const intentRows = tenantId === null ? db.all("SELECT * FROM audit_intents") : db.all("SELECT * FROM audit_intents WHERE tenant_id = ?", normalizeTenantId(tenantId));
      for (const row of intentRows) {
        const list = byIdem.get(row.idempotency_id) ?? [];
        const hasIntent = list.some((e) => e.phase === "intent");
        const hasOutcome = list.some((e) => e.phase === "outcome");
        if (!hasIntent) problems.push({ type: "missing-intent-event", idempotencyId: row.idempotency_id });
        const finalized = FINAL_STATES.has(row.state) || row.state === "unknown";
        if (finalized && !hasOutcome) problems.push({ type: "missing-outcome-event", idempotencyId: row.idempotency_id });
        if (!finalized && hasOutcome) problems.push({ type: "unexpected-outcome-event", idempotencyId: row.idempotency_id });
      }
      return { ok: problems.length === 0, problems, chain, tenants: audit.tenants() };
    },
  };

  return journal;
}
