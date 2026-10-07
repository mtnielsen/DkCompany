/**
 * DKC-021 — slette- og tilbageholdstjeneste.
 *
 * Tjenesten er den ene, autoriserede vej fra en sletteanmodning til et bevis:
 *
 *   1. tenant udledes/valideres af den verificerede principal (default-deny),
 *   2. AI-principals afvises altid, og en slette-/holdrolle kræves,
 *   3. aktive holds i scope kontrolleres **før** nogen mutation; et hold giver
 *      `blocked-by-hold` uden at slette noget,
 *   4. et revisionsintent skrives før mutationen; det indeholder kun subjektets
 *      digest og flade-id'er — aldrig rå identifikatorer eller slettede data,
 *   5. hver flade slettes og rapporterer ærligt, inkl. resterende kopier med
 *      begrundelse og forventet udløb,
 *   6. resultatet gemmes som en kvittering, og revisionssporet afsluttes.
 */
import { randomUUID } from "node:crypto";
import { assertTenantAccess, normalizeTenantId } from "../../identity/src/tenant.mjs";
import { AuthorizationError } from "../../identity/src/errors.mjs";
import { subjectDigest as digestOfSubject, buildIntentPayload, buildOutcomePayload } from "./audit.mjs";
import { buildHold } from "./holds.mjs";

export class DeletionError extends Error {
  constructor(message, code = "deletion_error") {
    super(message);
    this.name = "DeletionError";
    this.code = code;
  }
}

function rolesOf(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])]);
}

function isAiPrincipal(principal) {
  return principal?.ai === true || principal?.kind === "agent" || rolesOf(principal).has("agent");
}

function authorizeDeletion({ principal, tenantId, policy, action }) {
  if (!principal) throw new AuthorizationError("manglende principal", { status: 401, code: "principal_missing" });
  if (isAiPrincipal(principal)) {
    throw new AuthorizationError(`AI-principaler må ikke ${action}`, { status: 403, code: "ai_denied" });
  }
  assertTenantAccess({ principal, tenantId });
  const allowed = action === "place-hold" ? policy.principals.holdApproverRoles : policy.principals.deletionRoles;
  const roles = rolesOf(principal);
  const hasRole = (allowed ?? []).some((r) => roles.has(r));
  if (!allowed) throw new AuthorizationError(`handlingen '${action}' er ikke defineret i politikken`, { status: 403, code: "action_forbidden" });
  // En tenant-bundet sletterolle. Platform-admins med eksplicit scope må også,
  // men kun fordi de bærer en af de navngivne roller eller platform-admin-scope.
  if (!hasRole && !roles.has("platform-admin")) {
    throw new AuthorizationError(`principalen mangler en rolle der må ${action}`, { status: 403, code: "deletion_forbidden" });
  }
  return true;
}

function overallStatus(results) {
  if (!results.length) return "unsupported";
  if (results.every((r) => r.status === "unsupported")) return "unsupported";
  if (results.every((r) => r.status === "full" || r.status === "not-found")) return "full";
  return "partial";
}

function summarize(results) {
  return {
    surfaces: results.length,
    full: results.filter((r) => r.status === "full").length,
    partial: results.filter((r) => r.status === "partial").length,
    unsupported: results.filter((r) => r.status === "unsupported").length,
    blocked: results.filter((r) => r.status === "blocked-by-hold").length,
    recordsAffected: results.reduce((sum, r) => sum + (r.recordsAffected ?? 0), 0),
    remainingCopies: results.reduce((sum, r) => sum + (r.remainingCopies ?? []).length, 0),
  };
}

export function createDeletionService({ policy, store, surfaces, audit, clock = () => Date.now() } = {}) {
  if (!policy) throw new DeletionError("createDeletionService kræver en politik");
  if (!store) throw new DeletionError("createDeletionService kræver et register");
  if (!Array.isArray(surfaces) || surfaces.length === 0) throw new DeletionError("createDeletionService kræver mindst én sletteflade");
  const trail = audit ?? { begin: (i) => ({ intentId: `intent-${randomUUID()}`, ...i }), complete: (id, o) => ({ outcomeId: `outcome-${randomUUID()}`, intentId: id, ...o }) };

  function activeHolds(tenantId, { subjectDigest, dataClasses }) {
    return store.activeHoldsFor(tenantId, { subjectDigest, dataClasses });
  }

  return {
    kind: "deletion-service",

    /** Læg et begrundet, godkendt hold. Godkenderen skal være en anden person. */
    placeHold({ principal, tenantId, subjectKey, subjectDigest = null, dataClasses = null, moduleRef = null, reason, approvedBy, reviewAt = null, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId ?? principal?.tenantId);
      authorizeDeletion({ principal, tenantId: tenant, policy, action: "place-hold" });
      const digest = subjectDigest ?? digestOfSubject(subjectKey);
      const classes = dataClasses ?? (policy.surfaces ?? []).flatMap((s) => s.dataClasses);
      const hold = buildHold({
        tenantId: tenant,
        subjectDigest: digest,
        dataClasses: classes,
        moduleRef,
        reason,
        placedBy: { subject: principal.id, name: principal.name ?? principal.id, role: [...rolesOf(principal)][0] ?? "unknown" },
        approvedBy,
        reviewAt,
        now,
      });
      return store.placeHold(tenant, hold);
    },

    releaseHold({ principal, tenantId, holdId, releaseReason, now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId ?? principal?.tenantId);
      authorizeDeletion({ principal, tenantId: tenant, policy, action: "place-hold" });
      return store.releaseHold(tenant, holdId, {
        releasedBy: { subject: principal.id, name: principal.name ?? principal.id, role: [...rolesOf(principal)][0] ?? "unknown" },
        releaseReason,
        now,
      });
    },

    listHolds: ({ principal, tenantId, subjectDigest = null, includeReleased = false } = {}) => {
      const tenant = normalizeTenantId(tenantId ?? principal?.tenantId);
      assertTenantAccess({ principal, tenantId: tenant });
      return store.listHolds(tenant, { subjectDigest, includeReleased });
    },

    /**
     * Anmod om sletning. Returnerer en kvittering — også når et hold blokerer,
     * så forsøget og resultatet kan bevises.
     */
    requestDeletion({ principal, tenantId, subjectKey, subjectDigest = null, dataClasses = null, reason = "dsar-erasure", now = clock() } = {}) {
      const tenant = normalizeTenantId(tenantId ?? principal?.tenantId);
      authorizeDeletion({ principal, tenantId: tenant, policy, action: "delete" });
      const digest = subjectDigest ?? digestOfSubject(subjectKey);
      const classes = dataClasses ?? [...new Set((policy.surfaces ?? []).flatMap((s) => s.dataClasses))];

      const holds = activeHolds(tenant, { subjectDigest: digest, dataClasses: classes });
      const receiptId = `del:${tenant}:${digest.slice(0, 12)}:${new Date(now).toISOString()}`;
      const requestedBy = principal.id;

      // Revisionsintent FØR enhver mutation. Kun digest og flade-id'er.
      const intent = trail.begin(buildIntentPayload({ subjectDigest: digest, dataClasses: classes, surfaces, reason }));

      if (holds.length) {
        const results = surfaces.map((s) => ({
          surface: s.id,
          kind: s.kind,
          status: "blocked-by-hold",
          recordsAffected: 0,
          reason: `aktivt hold ${holds.map((h) => h.holdId).join(", ")} dækker subjektet`,
        }));
        const receipt = {
          apiVersion: "contracts.platform/v1alpha1",
          kind: "DeletionReceipt",
          receiptId,
          tenantId: tenant,
          subjectDigest: digest,
          requestedBy,
          requestedAt: new Date(now).toISOString(),
          completedAt: new Date(now).toISOString(),
          status: "blocked-by-hold",
          hold: { blocked: true, holdIds: holds.map((h) => h.holdId), reason: holds.map((h) => h.reason).join(" | ") },
          results,
          summary: summarize(results),
          audit: { intentId: intent.intentId, outcomeId: "pending", subjectDigest: digest, containsRawPersonalData: false },
        };
        const outcome = trail.complete(intent.intentId, buildOutcomePayload({ status: receipt.status, results, remainingCopies: [] }));
        receipt.audit.outcomeId = outcome.outcomeId;
        store.saveReceipt(tenant, receipt);
        return receipt;
      }

      const results = [];
      for (const surface of surfaces) {
        try {
          const result = surface.erase(tenant, digest, { now });
          results.push({ surface: surface.id, kind: surface.kind, status: result.status, recordsAffected: result.recordsAffected ?? 0, ...(result.reason ? { reason: result.reason } : {}), ...(result.remainingCopies?.length ? { remainingCopies: result.remainingCopies } : {}) });
        } catch (err) {
          results.push({ surface: surface.id, kind: surface.kind, status: "failed", recordsAffected: 0, reason: err.message });
        }
      }

      const status = overallStatus(results);
      const receipt = {
        apiVersion: "contracts.platform/v1alpha1",
        kind: "DeletionReceipt",
        receiptId,
        tenantId: tenant,
        subjectDigest: digest,
        requestedBy,
        requestedAt: new Date(now).toISOString(),
        completedAt: new Date(clock()).toISOString(),
        status,
        hold: { blocked: false, holdIds: [] },
        results,
        summary: summarize(results),
        audit: { intentId: intent.intentId, outcomeId: "pending", subjectDigest: digest, containsRawPersonalData: false },
      };
      const remainingCopies = results.flatMap((r) => r.remainingCopies ?? []);
      const outcome = trail.complete(intent.intentId, buildOutcomePayload({ status, results, remainingCopies }));
      receipt.audit.outcomeId = outcome.outcomeId;
      store.saveReceipt(tenant, receipt);
      return receipt;
    },
  };
}
