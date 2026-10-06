/**
 * DKC-020 — DSAR-sagens tjenestelag.
 *
 * Tjenesten binder den holdbare sag (`persistence/src/adapters/dsar.mjs`), den
 * autoriserede sagsbehandler, fan-out til modulerne og den sikrede eksport
 * sammen. Den er:
 *
 *   - **autoriseret**: enhver læse-/kør-/eksporthandling kræver en verificeret
 *     menneskelig sagsbehandler i sagens tenant (default-deny),
 *   - **genoptagelig**: et modul med terminal status køres ikke igen, mens
 *     `failed`/`unknown` forsøges på ny ved en genoptaget kørsel,
 *   - **ærlig**: timeout og nedetid giver `failed`/`unknown`, aldrig et fuldt svar,
 *   - **privatlivsbevarende**: rå modulposter ligger i et artefakt, ikke i
 *     registeret, og eksporten filtrerer andre personers data fra.
 */
import { randomUUID } from "node:crypto";
import { loadAllModules, orchestrate } from "../../conformance/src/dsar.mjs";
import { assertCaseworker, createCaseworkerAuthorizer } from "./authz.mjs";
import { filterSubjectRecords } from "./identity.mjs";

const TERMINAL = new Set(["full", "found", "partial", "unsupported"]);

function iso(ms) {
  return new Date(ms).toISOString();
}

function rawUri(tenantId, caseId, module) {
  return `memory://dsar/${tenantId}/${caseId}/${module}.json`;
}

function toResponseResult(result) {
  return {
    module: result.module,
    moduleVersion: result.moduleVersion ?? null,
    verb: result.verb,
    status: result.status,
    ...(result.recordsAffected !== null && result.recordsAffected !== undefined ? { recordsAffected: result.recordsAffected } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.artifactRef ? { artifactRef: result.artifactRef } : {}),
    ...(result.artifactSha256 ? { artifactSha256: result.artifactSha256 } : {}),
    ...(result.durationMs !== null && result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
  };
}

function summarize(results) {
  return {
    modulesQueried: results.length,
    full: results.filter((r) => r.status === "full").length,
    found: results.filter((r) => r.status === "found").length,
    partial: results.filter((r) => r.status === "partial").length,
    unsupported: results.filter((r) => r.status === "unsupported").length,
    failed: results.filter((r) => r.status === "failed").length,
    unknown: results.filter((r) => r.status === "unknown").length,
  };
}

export function createCaseService({
  store,
  exportService = null,
  artifactStore = null,
  authorizer = createCaseworkerAuthorizer(),
  modules = null,
  fanout = orchestrate,
  audit = () => {},
  clock = () => Date.now(),
  runTimeoutMs = 10_000,
} = {}) {
  if (!store) throw new Error("createCaseService kræver en store");
  const moduleList = modules ?? loadAllModules();

  function authorize(principal, tenantId, action, subject) {
    try {
      return assertCaseworker({ principal, tenantId, action, subject }, authorizer);
    } catch (err) {
      audit({ type: "privacy.case.denied", action, principal, tenantId, reason: err.message, code: err.code });
      throw err;
    }
  }

  return {
    kind: "privacy-case-service",

    openCase({ tenantId, verb, identifiers, principal, legalBasis = "gdpr-art-15", deadline = null, idempotencyKey = null, now = clock() } = {}) {
      if (!tenantId || !verb || !identifiers?.length) throw new Error("openCase kræver tenantId, verb og identifiers");
      authorize(principal, tenantId, "case.open", { identifiers });
      const caseworker = { subject: principal.id, name: principal.name ?? principal.id, role: (principal.roles ?? [])[0] ?? "privacy-officer" };
      const requestedBy = { kind: principal.kind, id: principal.id };
      const created = store.createCase({
        tenantId,
        caseId: randomUUID(),
        verb,
        identifiers,
        requestedBy,
        caseworker,
        status: "open",
        legalBasis,
        deadline,
        idempotencyKey,
        now,
      });
      if (!created.replayed) audit({ type: "privacy.case.opened", tenantId, caseId: created.caseId, verb, principal: principal.id });
      return created;
    },

    getCase: (tenantId, caseId) => store.getCase(tenantId, caseId),
    listCases: (tenantId, opts) => store.listCases(tenantId, opts),
    getExport: (tenantId, exportId) => store.getExport(tenantId, exportId),
    listExports: (tenantId, caseId) => store.listExports(tenantId, caseId),

    /**
     * Kør eller genoptag sagen. Kun ikke-terminale moduler kaldes; det gør en
     * afbrudt kørsel genoptagelig uden dobbeltarbejde.
     */
    async runCase({ tenantId, caseId, principal, endpoints = null, headers = null, timeoutMs = runTimeoutMs, now = clock() } = {}) {
      const current = store.getCase(tenantId, caseId);
      if (!current) throw new Error(`ukendt sag '${caseId}'`);
      authorize(principal, tenantId, "case.run", { identifiers: current.identifiers });
      store.updateCase(tenantId, caseId, { status: "running", now });

      const existing = store.listModuleResults(tenantId, caseId);
      const completed = new Set(existing.filter((r) => TERMINAL.has(r.status)).map((r) => r.module));
      const pending = moduleList.filter((m) => !completed.has(m.manifest.metadata?.name ?? m.dir));
      const request = {
        apiVersion: "contracts.platform/v1alpha1",
        kind: "PrivacySubjectRequest",
        requestId: randomUUID(),
        createdAt: iso(now),
        tenantId,
        verb: current.verb,
        subject: { identifiers: current.identifiers },
        legalBasis: { type: current.legalBasis ?? "gdpr-art-15" },
        requestedBy: current.requestedBy,
        targets: pending.map((m) => m.manifest.metadata?.name ?? m.dir),
      };

      if (pending.length > 0) {
        const response = await fanout(request, pending, { offline: false, endpoints, headers, timeoutMs });
        for (const result of response.results) {
          let artifactRef = null;
          let artifactSha256 = null;
          if (Array.isArray(result.records) && artifactStore) {
            const put = artifactStore.put(rawUri(tenantId, caseId, result.module), { module: result.module, records: result.records });
            artifactRef = put.uri;
            artifactSha256 = put.sha256;
          }
          store.upsertModuleResult(tenantId, {
            caseId,
            module: result.module,
            moduleVersion: result.moduleVersion,
            verb: result.verb,
            status: result.status,
            recordsAffected: result.recordsAffected ?? (Array.isArray(result.records) ? result.records.length : null),
            matched: result.status === "found" || (result.recordsAffected ?? 0) > 0,
            reason: result.reason ?? null,
            error: result.error ?? null,
            artifactRef,
            artifactSha256,
            durationMs: result.durationMs ?? null,
            now,
          });
        }
      }

      const results = store.listModuleResults(tenantId, caseId);
      const summary = summarize(results);
      const degraded = summary.failed > 0 || summary.unknown > 0 || summary.partial > 0 || summary.unsupported > 0;
      const status = degraded ? "partially-completed" : "completed";
      const finalResponse = {
        requestId: request.requestId,
        verb: current.verb,
        completedAt: iso(clock()),
        status,
        results: results.map(toResponseResult),
        summary,
      };
      const updated = store.updateCase(tenantId, caseId, { status, response: finalResponse, completedAt: iso(now), now });
      audit({ type: "privacy.case.run", tenantId, caseId, status, summary, principal: principal.id });
      return updated;
    },

    /**
     * Udsted en sikret eksport for en afsluttet sag. Kun subjektets egne poster
     * følger med; andre personers data filtreres fra og tælles.
     */
    createExport({ tenantId, caseId, principal, recipient = null, now = clock() } = {}) {
      if (!exportService || !artifactStore) throw new Error("createExport kræver exportService og artifactStore");
      const current = store.getCase(tenantId, caseId);
      if (!current) throw new Error(`ukendt sag '${caseId}'`);
      authorize(principal, tenantId, "case.export", { identifiers: current.identifiers });
      const results = store.listModuleResults(tenantId, caseId).filter((r) => r.artifactRef);
      const modules = results.map((r) => ({ module: r.module, records: artifactStore.get(r.artifactRef).records ?? [] }));
      const recipientId = recipient ?? principal.id;
      const exportRecord = exportService.issue({
        tenantId,
        caseId,
        verb: current.verb,
        recipient: recipientId,
        identifiers: current.identifiers,
        modules,
        issuedBy: principal.id,
        now,
      });
      store.updateCase(tenantId, caseId, { exportId: exportRecord.exportId, now });
      return exportRecord;
    },

    /** Indløs en eksport; kun den navngivne modtager må indløse den. */
    redeemExport({ tenantId, exportId, principal, now = clock() } = {}) {
      if (!exportService) throw new Error("redeemExport kræver exportService");
      if (!principal?.id) throw new Error("redeemExport kræver en principal");
      return exportService.redeem({ tenantId, exportId, recipient: principal.id, now });
    },

    authorizeCaseworker: (principal, tenantId, action, subject) => authorize(principal, tenantId, action, subject),
  };
}

export { filterSubjectRecords };
