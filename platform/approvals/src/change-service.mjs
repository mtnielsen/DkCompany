/**
 * DKC-045 — menneskestyret change-service.
 *
 * Tre flows deler én regel: en mutation udføres kun, hvis den er dækket af en
 * menneskelig autorisation, der er bundet til præcis den runbookversion, det
 * scope og den parameterramme, der faktisk udføres.
 *
 *   standard   En forhåndsgodkendt runbookversion inden for sin scope, sit
 *              udløb og sit forsøgsbudget. Ingen godkendelse pr. mutation —
 *              men kun fordi den menneskelige pre-approval dækker præcis denne
 *              version. Ny version eller større scope kræver ny godkendelse.
 *   normal     Ingen gyldig pre-approval → der kræves en konkret, ændrings-
 *              bundet godkendelse pr. mutation (approval-servicen).
 *   emergency  En særskilt, tidsbegrænset menneskelig autorisation fra en
 *              incident-commander. Den kan ikke ophæve A4- eller AI-immutable-
 *              grænser; runtimens uafhængige kontroller kører først.
 *
 * Servicen resolver runbookversionen server-side. Klienten kan ikke medsende
 * en digest; den udledes af den signerede runbook, der faktisk blev godkendt.
 */
import { randomUUID } from "node:crypto";
import { computeBindingDigest } from "./binding.mjs";
import { runbookProblems, verifyRunbookSignature, runbookDigest, runbookRef, scopeCovers, parameterProblems, preApprovalValid, CHANGE_FLOWS } from "./runbook.mjs";

export class ChangeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ChangeError";
    this.status = status;
  }
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

/**
 * @param {object} opts
 * @param {object} opts.approvalService  Den rigtige approval-service (DKC-004/005).
 * @param {object} opts.runbookKeyring   Nøglesæt til signaturverifikation.
 * @param {object} opts.calendar         Change-kalender (DKC-045).
 * @param {object} opts.preconditions    check-navn → funktion der returnerer værdi.
 * @param {object} opts.postchecks       check-navn → funktion der returnerer værdi.
 * @param {function} opts.rollbackExecutor  Udfører rollback for en change.
 * @param {function} opts.clock          Tidskilde.
 */
export function createChangeService({
  approvalService = null,
  runbookKeyring = {},
  calendar = null,
  preconditions = {},
  postchecks = {},
  rollbackExecutor = null,
  audit = null,
  clock = () => Date.now(),
  requireMaintenanceWindow = false,
} = {}) {
  const versions = new Map(); // name → Map(version → runbook)
  const active = new Map(); // name → version
  const preApprovals = new Map(); // digest → pre-approval record
  const changes = new Map(); // changeId → record

  function calendarOrFail() {
    if (!calendar) throw new ChangeError("change-servicen kræver en change-kalender", 500);
    return calendar;
  }

  function auditEvent(type, record, detail = null) {
    if (!audit || typeof audit.append !== "function") return;
    try {
      audit.append({
        id: record?.id ?? randomUUID(),
        type,
        at: nowIso(clock),
        tenantId: record?.tenantId ?? null,
        state: record?.state ?? null,
        detail,
      });
    } catch {
      /* audit er beskyttet og best-effort; en brudt kæde fanges af verifyChain */
    }
  }

  /** Registrér en signeret runbook. Uden gyldig signatur afvises den. */
  function registerRunbook(runbook, { activate = true, verifySignature = true } = {}) {
    if (verifySignature) {
      const verified = verifyRunbookSignature(runbook, runbookKeyring);
      if (!verified.ok) return { ok: false, digest: null, errors: [{ path: "/signature", message: verified.reason }] };
    }
    const errors = runbookProblems(runbook, { now: clock(), keyring: runbookKeyring, strictSignature: verifySignature });
    if (errors.length) return { ok: false, digest: null, errors };
    const name = runbook.metadata.name;
    const version = runbook.metadata.version;
    if (!versions.has(name)) versions.set(name, new Map());
    const digest = runbookDigest(runbook);
    versions.get(name).set(version, { runbook: structuredClone(runbook), digest, registeredAt: nowIso(clock) });
    if (activate) active.set(name, version);
    auditEvent("runbook.registered", { id: runbookRef(runbook) }, { digest, activate });
    return { ok: true, digest, ref: runbookRef(runbook) };
  }

  function getRunbook(name, version = null) {
    if (!name) return null;
    const v = version ?? active.get(name) ?? null;
    return versions.get(name)?.get(v) ?? null;
  }

  /** Slå en runbook op på `name` eller `name@version`. */
  function runbookFor(ref) {
    if (!ref) return null;
    const at = ref.lastIndexOf("@");
    if (at > 0) {
      const name = ref.slice(0, at);
      const version = ref.slice(at + 1);
      return getRunbook(name, version);
    }
    return getRunbook(ref);
  }

  /* ------------------------------------------------------------------------ */
  /* Forhåndsgodkendelse (standard change)                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Bind en allerede godkendt approval-anmodning til præcis denne
   * runbookversion. Godkendelsen skal være `approved`, mergeable og bundet til
   * runbookens digest — en `pending`/`expired`/`no-objection`-beslutning kan
   * aldrig blive en pre-approval.
   */
  function approveRunbook({ runbookRef: ref, approvalId, at = clock() }) {
    if (!approvalService) throw new ChangeError("pre-approval kræver en approval-service", 500);
    const entry = runbookFor(ref);
    if (!entry) throw new ChangeError(`ukendt runbook '${ref}'`, 404);
    const { runbook, digest } = entry;
    if (runbook.approval.flow !== "standard") throw new ChangeError("kun en standard-runbook kan forhåndsgodkendes", 409);

    let request;
    try {
      request = approvalService.get(approvalId);
    } catch (err) {
      throw new ChangeError(`godkendelsen '${approvalId}' findes ikke`, 404);
    }
    const merge = approvalService.mergeCheck(approvalId);
    if (request.decision.state !== "approved" || !merge.mergeable) {
      throw new ChangeError(`godkendelsen er ikke en gyldig, eksplicit godkendelse (tilstand '${request.decision.state}')`, 409);
    }
    // Bindingen skal pege på netop denne runbook-digest. Ellers er den en anden
    // handling (fx en anden version eller et andet scope).
    const boundRunbook = request.change?.runbook?.sha256 ?? null;
    if (boundRunbook !== digest) {
      throw new ChangeError("godkendelsen er bundet til en anden runbookversion/digest", 409);
    }
    const requestedTargets = [...(request.change?.targets ?? [])].map(String).sort();
    const scopeTargets = [...(runbook.scope?.targets ?? [])].map(String).sort();
    if (requestedTargets.length && JSON.stringify(requestedTargets) !== JSON.stringify(scopeTargets)) {
      throw new ChangeError("godkendelsens mål matcher ikke runbookens scope", 409);
    }

    const runbookExpiry = Date.parse(runbook.expiry?.expiresAt ?? "");
    const approvalExpiry = Date.parse(request.decision.expiresAt ?? "");
    const expiresAt = Math.min(Number.isFinite(runbookExpiry) ? runbookExpiry : Infinity, Number.isFinite(approvalExpiry) ? approvalExpiry : Infinity);
    const record = {
      id: `pre-${randomUUID()}`,
      runbook: runbookRef(runbook),
      digest,
      approvalId,
      approvalBindingDigest: request.decision.binding?.digest ?? null,
      approvedAt: at,
      expiresAt: new Date(expiresAt).toISOString(),
      scope: structuredClone(runbook.scope),
      maxAttempts: runbook.attempts?.maxAttempts ?? 0,
      attempts: 0,
      consumedChangeIds: [],
    };
    // En ny godkendelse for samme digest erstatter den gamle.
    preApprovals.set(digest, record);
    auditEvent("runbook.preapproved", { id: runbookRef(runbook), tenantId: request.tenantId ?? null }, { approvalId, digest });
    return record;
  }

  function getPreApproval(digest) {
    return preApprovals.get(digest) ?? null;
  }

  /* ------------------------------------------------------------------------ */
  /* Resolver (server-side)                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Resolve og autorisér en mutation mod en signeret runbook. Returnerer
   * `{ ok, requiresApproval, flow, digest, runbook, changeId, reasons }`.
   *
   * `ok:false` betyder at mutationen ikke er dækket og ikke må udføres.
   * `requiresApproval:true` betyder at der kræves en konkret menneskelig
   * godkendelse pr. mutation (normal/emergency).
   */
  function resolve({ runbookRef: ref = null, verb, target, environment, tenantId = null, parameters = null, at = clock(), emergencyAuthorization = null, approvalVerifier = null } = {}) {
    const reasons = [];
    if (!ref) {
      return { ok: true, requiresApproval: true, flow: "normal", digest: null, runbook: null, changeId: null, reasons: ["ingen runbook reference — der kræves godkendelse pr. mutation"] };
    }
    const entry = runbookFor(ref);
    if (!entry) return { ok: false, requiresApproval: true, flow: "normal", digest: null, runbook: null, changeId: null, reasons: [`runbook '${ref}' er ikke registreret`] };
    const { runbook, digest } = entry;

    const verified = verifyRunbookSignature(runbook, runbookKeyring);
    if (!verified.ok) return { ok: false, requiresApproval: true, flow: runbook.approval?.flow ?? "normal", digest, runbook, changeId: null, reasons: [verified.reason] };

    const semantic = runbookProblems(runbook, { now: at, keyring: runbookKeyring });
    if (semantic.length) return { ok: false, requiresApproval: true, flow: runbook.approval?.flow ?? "normal", digest, runbook, changeId: null, reasons: semantic.map((p) => `${p.path} ${p.message}`) };

    if (!scopeCovers(runbook, { verb, target, environment, tenantId })) {
      return { ok: false, requiresApproval: true, flow: runbook.approval?.flow ?? "normal", digest, runbook, changeId: null, reasons: [`handlingen (${verb} @ ${target} i ${environment}) ligger uden for runbookens scope`] };
    }
    const paramProblems = parameterProblems(runbook, parameters ?? {});
    if (paramProblems.length) return { ok: false, requiresApproval: true, flow: runbook.approval?.flow ?? "normal", digest, runbook, changeId: null, reasons: paramProblems.map((p) => `${p.path} ${p.message}`) };

    // Forudsætninger skal være opfyldt, før noget planlægges.
    for (const pre of runbook.preconditions ?? []) {
      const check = preconditions[pre.check];
      const actual = typeof check === "function" ? check({ runbook, verb, target, environment, tenantId, parameters }) : undefined;
      if (actual !== pre.expect) reasons.push(`forudsætningen '${pre.id}' er ikke opfyldt (forventede '${pre.expect}', fik '${String(actual)}')`);
    }
    if (reasons.length) return { ok: false, requiresApproval: true, flow: runbook.approval?.flow ?? "normal", digest, runbook, changeId: null, reasons };

    // Vedligeholdelsesvindue.
    const cal = calendarOrFail();
    const flow = runbook.approval?.flow ?? "normal";
    if (requireMaintenanceWindow && flow !== "emergency") {
      const windows = cal.withinMaintenanceWindow({ target, environment, at });
      if (windows.length === 0) return { ok: false, requiresApproval: true, flow, digest, runbook, changeId: null, reasons: [`'${target}' er ikke i et vedligeholdelsesvindue på det ønskede tidspunkt`] };
    }
    const durationSeconds = Math.min(runbook.maxImpact?.maxDurationSeconds ?? 0, parameters?.maxDurationSeconds ?? Infinity);
    const windowStart = new Date(at).toISOString();
    const durationMs = Number.isFinite(durationSeconds) ? durationSeconds * 1000 : 0;
    const windowEnd = new Date(at + durationMs).toISOString();

    const changeId = `chg-${randomUUID()}`;
    let requiresApproval = flow !== "standard";
    let preApproval = null;
    let emergencyProblems = null;
    if (flow === "standard") {
      preApproval = getPreApproval(digest);
      const validity = preApprovalValid(preApproval, runbook, at);
      if (!validity.ok) {
        // En standard-runbook uden gyldig pre-approval falder tilbage til
        // menneskelig godkendelse pr. mutation.
        requiresApproval = true;
      } else {
        // Forbrug ét forsøg på pre-approvalen. Ny version/scope har sin egen.
        preApproval.attempts = (preApproval.attempts ?? 0) + 1;
      }
    }

    // Emergency kræver en særskilt, eksplicit menneskelig autorisation. Den
    // forbruges pr. mutation og kan kun udstedes til en incident-commander.
    if (flow === "emergency") {
      const emergency = validateEmergencyAuthorization({ emergencyAuthorization, digest, runbook, target, environment, tenantId, approvalVerifier });
      if (!emergency.ok) {
        emergencyProblems = emergency.reasons;
        requiresApproval = true;
      }
    }

    const record = {
      id: changeId,
      tenantId,
      verb,
      targets: [target],
      environment,
      parameters: structuredClone(parameters ?? {}),
      flow,
      state: requiresApproval ? "approval" : "implementing",
      runbook: runbookRef(runbook),
      runbookDigest: digest,
      lock: null,
      attempts: 0,
      createdAt: windowStart,
      window: { start: windowStart, end: windowEnd },
    };
    if (preApproval && !requiresApproval) record.preApprovalId = preApproval.id;
    if (flow === "standard" && requiresApproval) record.preApprovalFallbackReason = preApprovalValid(preApproval, runbook, at).reason;
    if (emergencyProblems) record.emergencyProblems = emergencyProblems;
    if (flow === "emergency" && !requiresApproval) record.emergencyAuthorizationId = emergencyAuthorization.approvalId;

    // Kun en dækket standard-change tager låsen med det samme. En normal/
    // emergency-change tager låsen i `commit`, efter den menneskelige
    // autorisation er verificeret, så en afvist godkendelse ikke holder låsen.
    if (!requiresApproval) {
      const conflicts = cal.conflicts({ targets: [target], environment, start: windowStart, end: windowEnd });
      if (conflicts.length) {
        if (preApproval) preApproval.attempts = Math.max(0, (preApproval.attempts ?? 1) - 1);
        return { ok: false, requiresApproval: false, flow, digest, runbook, changeId: null, reasons: [`change-konflikt på '${target}' med ${conflicts.map((c) => c.id).join(", ")}`] };
      }
      const lock = cal.acquireLocks({ targets: [target], changeId, ttlSeconds: Math.max(600, durationSeconds || 600), at });
      if (!lock.ok) {
        if (preApproval) preApproval.attempts = Math.max(0, (preApproval.attempts ?? 1) - 1);
        return { ok: false, requiresApproval: false, flow, digest, runbook, changeId: null, reasons: [`ressourcen '${lock.target}' er låst af en anden change (${lock.heldBy})`] };
      }
      record.lock = lock;
    }

    changes.set(changeId, record);
    cal.upsertChange(record);
    auditEvent("change.resolved", record, { flow, requiresApproval, digest, preApprovalId: record.preApprovalId ?? null });

    return { ok: true, requiresApproval, flow, digest, runbook, changeId, preApproval, record: structuredClone(record), reasons: [] };
  }

  /**
   * Tag låsen for en change, der først blev autoriseret efter `resolve`
   * (normal/emergency). Kaldes lige før eksekvering. Idempotent.
   */
  function commit({ changeId, at = clock() } = {}) {
    const record = changes.get(changeId);
    if (!record) return { ok: false, reasons: [`ukendt change '${changeId}'`] };
    if (record.lock?.acquired) return { ok: true, change: structuredClone(record) };
    const runbook = runbookFor(record.runbook)?.runbook ?? null;
    const cal = calendarOrFail();
    const durationSeconds = runbook?.maxImpact?.maxDurationSeconds ?? 0;
    const conflicts = cal.conflicts({ targets: record.targets, environment: record.environment, start: record.window.start, end: record.window.end, excludeChangeId: record.id });
    if (conflicts.length) return { ok: false, reasons: [`change-konflikt på ${record.targets.join(", ")} med ${conflicts.map((c) => c.id).join(", ")}`] };
    const lock = cal.acquireLocks({ targets: record.targets, changeId, ttlSeconds: Math.max(600, durationSeconds || 600), at });
    if (!lock.ok) return { ok: false, reasons: [`ressourcen '${lock.target}' er låst af en anden change (${lock.heldBy})`] };
    record.lock = lock;
    record.state = "implementing";
    cal.upsertChange(record);
    changes.set(changeId, record);
    auditEvent("change.committed", record, { lock: lock.acquired });
    return { ok: true, change: structuredClone(record) };
  }

  /**
   * Emergency-autorisation: en eksplicit `runbook.emergency`-godkendelse, der
   * er bundet til runbook-digesten, målet og det aktuelle tidsrum. A4/AI-
   * immutable håndhæves uafhængigt af runtimen og kan ikke omgås her.
   */
  function validateEmergencyAuthorization({ emergencyAuthorization, digest, runbook, target, environment, tenantId, approvalVerifier }) {
    const reasons = [];
    if (!emergencyAuthorization || !emergencyAuthorization.approvalId) {
      return { ok: false, reasons: ["emergency-flow kræver en særskilt menneskelig autorisation"] };
    }
    if (!approvalService) return { ok: false, reasons: ["approval-service er ikke konfigureret"] };
    let request;
    try {
      request = approvalService.get(emergencyAuthorization.approvalId);
    } catch {
      return { ok: false, reasons: ["emergency-autorisationen findes ikke"] };
    }
    if (request.decision.state !== "approved") reasons.push(`emergency-autorisationen er '${request.decision.state}', ikke 'approved'`);
    if (request.change?.verb !== "runbook.emergency") reasons.push("autorisationen er ikke udstedt til emergency-flowet");
    if (request.change?.emergency !== true) reasons.push("autorisationen mangler det eksplicitte emergency-flag");
    if ((request.change?.runbook?.sha256 ?? null) !== digest) reasons.push("autorisationen er bundet til en anden runbookversion");
    if (!(request.change?.targets ?? []).map(String).includes(String(target))) reasons.push("autorisationen dækker ikke målet");
    if (request.change?.environment && request.change.environment !== environment) reasons.push("autorisationen dækker ikke miljøet");
    if (request.tenantId && tenantId && request.tenantId !== tenantId) reasons.push("autorisationen tilhører en anden kunde");
    if (reasons.length) return { ok: false, reasons };
    // Emergency forbruges pr. mutation: verificér og reserver gennem den
    // rigtige approval-service, så to samtidige emergency-handlinger ikke kan
    // bruge samme autorisation.
    const verifier = approvalVerifier?.authorizeExecution ? approvalVerifier : null;
    if (verifier) {
      // Selve reservationen sker i runtimen lige før eksekvering; her
      // konstaterer vi blot at bindingen er intakt.
      const merge = approvalService.mergeCheck(emergencyAuthorization.approvalId);
      if (!merge.mergeable) reasons.push(`autorisationen kan ikke anvendes: ${merge.reasons.join("; ")}`);
    }
    return { ok: reasons.length === 0, reasons, request };
  }

  /* ------------------------------------------------------------------------ */
  /* Afslutning: postchecks og rollback                                       */
  /* ------------------------------------------------------------------------ */

  /**
   * Afslut en change. Kører postchecks; fejler en postcheck med `rollback`,
   * udføres den (via `rollbackExecutor`) og changen markeres `rolled_back`.
   * Låse frigives altid.
   */
  function finalize({ changeId, outcome = "succeeded", result = null, at = clock() }) {
    const record = changes.get(changeId);
    if (!record) throw new ChangeError(`ukendt change '${changeId}'`, 404);
    const runbook = runbookFor(record.runbook)?.runbook ?? null;
    const postcheckResults = [];
    let rollbackPerformed = false;

    if (outcome === "succeeded" && runbook) {
      for (const post of runbook.postchecks ?? []) {
        const fn = postchecks[post.check];
        const actual = typeof fn === "function" ? fn({ change: record, runbook, result }) : undefined;
        const ok = actual === post.expect;
        postcheckResults.push({ id: post.id, ok, expect: post.expect, actual: actual ?? null, onFailure: post.onFailure });
        if (!ok && post.onFailure === "rollback") {
          if (typeof rollbackExecutor === "function") {
            try {
              rollbackExecutor({ change: record, runbook, result });
              rollbackPerformed = true;
            } catch (err) {
              postcheckResults.push({ id: post.id, ok: false, error: err.message });
            }
          } else {
            postcheckResults.push({ id: post.id, ok: false, error: "ingen rollback-executor konfigureret" });
          }
        }
      }
    }

    const failed = postcheckResults.filter((p) => !p.ok);
    if (outcome !== "succeeded") record.state = "rolled_back";
    else if (failed.length === 0) record.state = "implemented";
    else record.state = rollbackPerformed ? "rolled_back" : "implementing";
    record.finalizedAt = nowIso(clock);
    record.outcome = outcome;
    record.postcheckResults = postcheckResults;

    if (record.lock?.acquired) calendarOrFail().releaseLocks({ targets: record.targets, changeId: record.id });
    calendarOrFail().upsertChange(record);
    changes.set(changeId, record);
    auditEvent("change.finalized", record, { outcome, rollbackPerformed, failed: failed.length });
    return { ok: failed.length === 0, state: record.state, postcheckResults, rollbackPerformed, change: structuredClone(record) };
  }

  /** Frigiv en reserveret lås uden at afslutte (fx når en approval afvises). */
  function release({ changeId }) {
    const record = changes.get(changeId);
    if (!record) return { ok: false };
    if (record.lock?.acquired) calendarOrFail().releaseLocks({ targets: record.targets, changeId: record.id });
    if (record.state === "approval") record.state = "cancelled";
    calendarOrFail().upsertChange(record);
    changes.set(changeId, record);
    return { ok: true, change: structuredClone(record) };
  }

  function getChange(id) {
    const value = changes.get(id);
    return value ? structuredClone(value) : null;
  }

  function listChanges() {
    return [...changes.values()].map((c) => structuredClone(c));
  }

  /** Bindingen en normal change-godkendelse skal matche. */
  function bindingFor({ tenantId, verb, target, environment, parameters, changeId }) {
    const record = changes.get(changeId);
    const digest = record?.runbookDigest ?? null;
    return computeBindingDigest({
      tenantId,
      change: { environment, verb, targets: [target], runbook: digest ? { sha256: digest } : undefined, parameters: parameters ?? null },
      evidence: { policyEvaluation: { bundleVersion: null } },
      decision: { expiresAt: record ? null : null },
    });
  }

  return {
    kind: "change-service",
    registerRunbook,
    getRunbook,
    runbookFor,
    approveRunbook,
    getPreApproval,
    resolve,
    commit,
    finalize,
    release,
    getChange,
    listChanges,
    bindingFor,
    calendar,
    versions,
    preApprovals,
    changes,
    flows: CHANGE_FLOWS,
  };
}
