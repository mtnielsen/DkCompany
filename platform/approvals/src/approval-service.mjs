import { createServer } from "node:http";
import { checkClaims } from "./claims.mjs";
import { bindingDrift, bindingRecord, computeBinding, computeBindingDigest } from "./binding.mjs";
import { resolvePolicy } from "./approval-policy.mjs";
import { createMemoryStore } from "./store.mjs";
import { createApprovalLedger } from "./ledger.mjs";
import { authorizeTenantAccess } from "../../identity/src/tenant.mjs";

const INTERNAL = Symbol("approval trusted internal call");

export class ApprovalError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
  }
}

/** Terminale tilstande kan ikke forlade sig selv. `approved` kan udløbe/tilbagekaldes. */
const ALLOWED_TRANSITIONS = {
  pending: new Set(["approved", "rejected", "expired", "withdrawn", "revoked"]),
  approved: new Set(["expired", "revoked"]),
  rejected: new Set(),
  expired: new Set(),
  withdrawn: new Set(),
  revoked: new Set(),
};

function assertHumanPrincipal(principal) {
  if (!principal || typeof principal.id !== "string" || principal.id.length === 0) {
    throw new ApprovalError("manglende verificeret godkender-identitet", 401);
  }
  if (principal.kind !== "human") {
    throw new ApprovalError("kun verificerede mennesker kan godkende", 403);
  }
  if (principal.demo === true) {
    throw new ApprovalError("demo-identitet kan ikke godkende", 403);
  }
}

function roleSet(principal) {
  return new Set([...(principal?.groups ?? []), ...(principal?.roles ?? [])]);
}

/**
 * Approval-service.
 *
 * Håndhæver:
 *   - serverstyret pending-state (klienten kan ikke oprette `approved`)
 *   - serverstyret træningsopslag (klientens kursusbeviser ignoreres)
 *   - at kun verificerede mennesker kan godkende, med grupper fra identiteten
 *   - unikke godkendere og forbud mod selv-godkendelse efter politik
 *   - binding til kunde, miljø, verbum, mål, parameter-/diff-digest,
 *     policy-version og udløb
 *   - kontrolleret state machine med afvisning, udløb og tilbagekaldelse
 *
 * `evidence` (maskine) og `agentAssessment` (prosa) holdes adskilt — også i den
 * renderede visning.
 */
export function createApprovalService({
  trainingRegistry = () => [],
  approvalPolicy,
  authenticator = null,
  store = null,
  ledger = null,
  clock = () => Date.now(),
  onDecision = () => {},
  onTrustedCapability = null,
} = {}) {
  const requestStore = store ?? createMemoryStore();
  const audit = ledger ?? createApprovalLedger();
  const requests = new Map();

  // Genopbyg tilstand efter en genstart. Bindingen på hver anmodning er
  // serverstyret og verificeres af `bindingDrift` ved brug.
  for (const persisted of requestStore.load()) requests.set(persisted.id, persisted);

  function persist(req) {
    requestStore.save(req);
    return req;
  }

  function auditEvent(type, req, actor, detail) {
    return audit.append({
      id: req.id,
      type,
      at: new Date(clock()).toISOString(),
      tenantId: req.tenantId ?? null,
      state: req.decision?.state ?? null,
      bindingDigest: req.decision?.binding?.digest ?? null,
      actor: actor ?? null,
      detail: detail ?? null,
    });
  }

  function denied(operation, id, principal, error) {
    // Keep denials useful for incident review without copying caller payloads.
    audit.append({ id: id ?? "unknown", type: "approval.access_denied", at: new Date(clock()).toISOString(), tenantId: principal?.tenantId ?? null, actor: principal?.id ?? null, detail: { operation, status: error.status ?? 403 } });
    throw error;
  }

  function requirePrincipal(principal, operation, id = null) {
    if (!principal || typeof principal.id !== "string" || !principal.id) {
      denied(operation, id, principal, new ApprovalError("verificeret identitet mangler", 401));
    }
    if (!["human", "workload", "service"].includes(principal.kind)) denied(operation, id, principal, new ApprovalError("identitetstypen er ikke tilladt", 403));
  }

  function authorizeRequest(req, principal, operation) {
    requirePrincipal(principal, operation, req.id);
    let access;
    try { access = authorizeTenantAccess({ principal, tenantId: req.tenantId }); }
    catch (err) { denied(operation, req.id, principal, new ApprovalError(err.message, 403)); }
    if (!access.allowed) denied(operation, req.id, principal, new ApprovalError(access.reason, 403));
    return req;
  }

  function authorizedRequest(id, principal, operation, { expire = true } = {}) {
    requirePrincipal(principal, operation, id);
    const req = requests.get(id);
    if (!req) throw new ApprovalError("anmodning findes ikke", 404);
    authorizeRequest(req, principal, operation);
    return expire ? expireIfNeeded(req) : req;
  }

  function transition(req, to, extra = {}) {
    const from = req.decision.state;
    if (from === to) {
      Object.assign(req.decision, extra);
      return req;
    }
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed || !allowed.has(to)) {
      throw new ApprovalError(`ulovlig tilstandsovergang ${from} → ${to}`, 409);
    }
    req.decision.state = to;
    Object.assign(req.decision, extra);
    return req;
  }

  function expireIfNeeded(req) {
    const state = req.decision.state;
    if (state !== "pending" && state !== "approved") return req;
    if (!req.decision.expiresAt) return req;
    if (clock() > Date.parse(req.decision.expiresAt)) {
      transition(req, "expired", { expiredAt: new Date(clock()).toISOString() });
      persist(req);
      auditEvent("approval.expired", req, "system");
    }
    return req;
  }

  function create(payload, { principal } = {}) {
    for (const field of ["id", "tenantId", "agent", "change", "evidence", "agentAssessment", "decision"]) {
      if (payload?.[field] === undefined) throw new ApprovalError(`manglende felt '${field}'`, 400);
    }
    if (principal !== INTERNAL) {
      requirePrincipal(principal, "create", payload?.id);
      // DKC-006: en anmoder fra én kunde må ikke oprette en godkendelse for en
      // anden kunde uden en særskilt platformrolle og eksplicit scope.
      let access;
      try { access = authorizeTenantAccess({ principal, tenantId: payload.tenantId }); }
      catch (err) { denied("create", payload?.id, principal, new ApprovalError(err.message, 403)); }
      if (!access.allowed) denied("create", payload?.id, principal, new ApprovalError(access.reason, 403));
    }

    const stored = structuredClone(payload);

    // Klienten må ikke påstå en anden tilstand end pending eller medsende
    // godkendelser. Serveren ejer state machine og approvals-listen.
    if (stored.decision?.state !== undefined && stored.decision.state !== "pending") {
      throw new ApprovalError("en anmodning kan kun oprettes i tilstanden 'pending'", 400);
    }
    if ((stored.decision?.approvals ?? []).length > 0) {
      throw new ApprovalError("klienten må ikke medsende godkendelser", 400);
    }

    const policy = resolvePolicy(stored, approvalPolicy);
    stored.decision = {
      ...stored.decision,
      state: "pending",
      approvals: [],
      requiredApprovals: policy.requiredApprovals,
      eligibleGroups: policy.eligibleGroups,
      requiredTrainingModules: policy.requiredTrainingModules,
      expiresAt: new Date(clock() + policy.expiresInSeconds * 1000).toISOString(),
      // Serverstyret: kun en verificeret skaber kan sætte requestedBy.
      requestedBy: principal?.id ?? null,
    };
    delete stored.decision.binding;
    stored.decision.binding = bindingRecord(stored, { at: new Date(clock()).toISOString() });

    if (requests.has(stored.id)) throw new ApprovalError("approval-id findes allerede", 409);
    requests.set(stored.id, stored);
    persist(stored);
    auditEvent("approval.created", stored, principal?.id ?? null);
    return structuredClone(stored);
  }

  function createPublic(payload, principal) {
    // In-process callers must pass the actor produced by their trusted
    // authentication middleware; HTTP callers get this only from authenticator.
    requirePrincipal(principal, "create", payload?.id);
    if (principal.kind === "human" && principal.demo === true) denied("create", payload?.id, principal, new ApprovalError("demo-identitet kan ikke oprette godkendelser", 403));
    return create(payload, { principal });
  }

  function getRaw(id) {
    const req = requests.get(id);
    if (!req) throw new ApprovalError("anmodning findes ikke", 404);
    return req;
  }

  function invalidate(req, reason) {
    req.decision.approvals = [];
    req.decision.invalidatedAt = new Date(clock()).toISOString();
    req.decision.invalidationReason = reason;
    if (req.decision.state === "approved") req.decision.state = "pending";
    persist(req);
  }

  function decide(id, { principal, verdict, comment, changeDigest } = {}) {
    const req = authorizedRequest(id, principal, "decide", { expire: false });

    try { assertHumanPrincipal(principal); }
    catch (err) { denied("decide", id, principal, err); }
    if (!["approve", "reject"].includes(verdict)) throw new ApprovalError("verdict skal være approve eller reject", 400);
    if (comment !== undefined && comment !== null && typeof comment !== "string") throw new ApprovalError("comment skal være en streng", 400);

    const policy = resolvePolicy(req, approvalPolicy);
    if (policy.selfApprovalForbidden && req.decision.requestedBy && principal.id === req.decision.requestedBy) {
      denied("decide", id, principal, new ApprovalError("selv-godkendelse er forbudt efter rollepolitik", 403));
    }
    const eligible = req.decision.eligibleGroups ?? [];
    const groups = roleSet(principal);
    if (eligible.length && !eligible.some((g) => groups.has(g))) {
      denied("decide", id, principal, new ApprovalError("godkender er ikke i en godkendt gruppe", 403));
    }

    expireIfNeeded(req);
    if (req.decision.state === "expired") throw new ApprovalError("anmodningen er udløbet", 410);
    if (req.decision.state !== "pending") throw new ApprovalError(`anmodningen er allerede ${req.decision.state}`, 409);

    const current = computeBindingDigest(req);

    // Godkenderen skal have set præcis denne ændring. Hvis requesten er ændret
    // siden oprettelsen, eller digesten ikke matcher, ugyldiggøres godkendelsen.
    if (changeDigest !== undefined && changeDigest !== current) {
      invalidate(req, "godkenderens digest matcher ikke ændringen");
      throw new ApprovalError("ændringen er ikke den godkendte (binding-mismatch)", 409);
    }
    const drift = bindingDrift(req);
    if (drift.length) {
      invalidate(req, drift.join("; "));
      throw new ApprovalError(`ændringen er ændret siden oprettelsen: ${drift.join("; ")}`, 409);
    }

    // Kunden (tenant) er en del af bindingen: en godkender fra en anden kunde
    // kan kun godkende med en særskilt platformrolle og en eksplicit scope for
    // netop den kunde. Rollen alene er ikke nok.
    if (req.tenantId && principal.tenantId && principal.tenantId !== req.tenantId) {
      const access = authorizeTenantAccess({ principal, tenantId: req.tenantId });
      if (!access.allowed) denied("decide", id, principal, new ApprovalError("godkenderen tilhører en anden kunde", 403));
    }

    // Træning kommer udelukkende fra det serverstyrede opslag — klientens
    // `completedTrainingModules` ignoreres.
    const required = req.decision.requiredTrainingModules ?? [];
    const completed = new Set(trainingRegistry(principal.id, { tenantId: req.tenantId, request: req }) ?? []);
    const missing = required.filter((m) => !completed.has(m));
    if (missing.length) denied("decide", id, principal, new ApprovalError(`godkender mangler træningsmoduler: ${missing.join(", ")}`, 428));

    // Unikke godkendere: samme identitet må ikke tælle to gange.
    if (req.decision.approvals.some((a) => a.subject === principal.id)) {
      denied("decide", id, principal, new ApprovalError("samme person kan ikke godkende mere end én gang", 409));
    }

    const record = {
      subject: principal.id,
      actorKind: principal.kind,
      bindingDigest: current,
      at: new Date(clock()).toISOString(),
      verdict,
      ...(comment ? { comment } : {}),
      ...(required.length ? { trainingVerified: true } : {}),
    };
    req.decision.approvals.push(record);

    if (verdict === "reject") {
      transition(req, "rejected", { decidedAt: record.at, decidedBy: principal.id });
    } else {
      const unique = new Set(
        req.decision.approvals.filter((a) => a.verdict === "approve" && a.bindingDigest === current).map((a) => a.subject)
      );
      if (unique.size >= req.decision.requiredApprovals) {
        transition(req, "approved", { decidedAt: record.at, decidedBy: principal.id });
      }
    }
    persist(req);
    auditEvent("approval.decided", req, principal.id, { verdict });
    onDecision(structuredClone({ id, state: req.decision.state, record }));
    return structuredClone(req);
  }

  /**
   * Opdatér den bundne ændring. Enhver ændring af et bundet felt ugyldiggør
   * tidligere godkendelser og sætter anmodningen tilbage til pending.
   */
  function amend(id, patch = {}, { principal } = {}) {
    const req = authorizedRequest(id, principal, "amend", { expire: false });
    if (principal.kind !== "human" || (principal.id !== req.decision.requestedBy && !roleSet(principal).has("approval-managers"))) denied("amend", id, principal, new ApprovalError("kun anmoderen eller en approval-manager må ændre anmodningen", 403));
    expireIfNeeded(req);
    const safePatch = structuredClone(patch ?? {});
    for (const forbidden of ["id", "tenantId", "decision", "agent", "signature"]) if (safePatch[forbidden] !== undefined) throw new ApprovalError(`feltet '${forbidden}' kan ikke ændres`, 400);
    if (["rejected", "expired", "withdrawn", "revoked"].includes(req.decision.state)) {
      throw new ApprovalError(`kan ikke ændre en ${req.decision.state} anmodning`, 409);
    }
    const before = computeBindingDigest(req);
    if (safePatch.tenantId !== undefined) req.tenantId = String(safePatch.tenantId);
    if (safePatch.change) {
      req.change = { ...req.change, ...safePatch.change, ...(safePatch.change.diff ? { diff: safePatch.change.diff } : {}) };
    }
    if (safePatch.evidence) req.evidence = { ...req.evidence, ...safePatch.evidence };
    if (safePatch.agentAssessment) req.agentAssessment = safePatch.agentAssessment;
    const after = computeBindingDigest(req);
    if (before !== after) {
      invalidate(req, "ændringen er opdateret");
      req.decision.state = "pending";
      delete req.decision.decidedAt;
      delete req.decision.decidedBy;
    }
    req.decision.binding = bindingRecord(req, { at: new Date(clock()).toISOString() });
    persist(req);
    auditEvent("approval.amended", req, principal?.id ?? null, { invalidated: before !== after });
    return structuredClone(req);
  }

  /** Tilbagekaldelse. Kun roller udpeget af politikken må tilbagekalde. */
  function revoke(id, { principal, reason } = {}) {
    const req = authorizedRequest(id, principal, "revoke", { expire: false });
    try { assertHumanPrincipal(principal); }
    catch (err) { denied("revoke", id, principal, err); }
    if (reason !== undefined && reason !== null && typeof reason !== "string") throw new ApprovalError("reason skal være en streng", 400);
    const policy = resolvePolicy(req, approvalPolicy);
    const roles = roleSet(principal);
    if (!policy.revocationRoles.some((r) => roles.has(r))) {
      denied("revoke", id, principal, new ApprovalError("godkenderen har ikke ret til at tilbagekalde", 403));
    }
    expireIfNeeded(req);
    if (req.decision.state === "revoked") return structuredClone(req);
    if (!["pending", "approved"].includes(req.decision.state)) {
      throw new ApprovalError(`kan ikke tilbagekalde en ${req.decision.state} anmodning`, 409);
    }
    const at = new Date(clock()).toISOString();
    transition(req, "revoked", {
      revokedAt: at,
      revokedBy: principal.id,
      revocationReason: reason ?? "tilbagekaldt",
    });
    persist(req);
    auditEvent("approval.revoked", req, principal.id, { reason: reason ?? null });
    onDecision(structuredClone({ id, state: req.decision.state, record: { subject: principal.id, verdict: "revoke", at } }));
    return structuredClone(req);
  }

  function withdraw(id, { principal, reason } = {}) {
    const req = authorizedRequest(id, principal, "withdraw", { expire: false });
    if (reason !== undefined && reason !== null && typeof reason !== "string") throw new ApprovalError("reason skal være en streng", 400);
    if (!req.decision.requestedBy || principal.id !== req.decision.requestedBy) {
      denied("withdraw", id, principal, new ApprovalError("kun den oprindelige anmoder kan trække anmodningen tilbage", 403));
    }
    expireIfNeeded(req);
    if (req.decision.state !== "pending") throw new ApprovalError(`kan ikke trække en ${req.decision.state} anmodning tilbage`, 409);
    const at = new Date(clock()).toISOString();
    transition(req, "withdrawn", { withdrawnAt: at, withdrawnBy: principal?.id ?? req.decision.requestedBy ?? null, withdrawalReason: reason ?? "trukket tilbage" });
    persist(req);
    auditEvent("approval.withdrawn", req, principal?.id ?? null);
    return structuredClone(req);
  }

  /**
   * A3 kan ikke merges uden menneske. En beslutning kan kun anvendes, hvis
   * tilstanden er `approved`, bindingen er intakt, alle godkendelser er bundet
   * til samme ændring, der er nok unikke godkendere, og intet er udløbet.
   */
  function mergeCheckRaw(id) {
    const req = getRaw(id);
    const reasons = [];
    if (req.decision.state !== "approved") reasons.push(`tilstand er '${req.decision.state}'`);
    reasons.push(...bindingDrift(req));

    const current = computeBindingDigest(req);
    const approvals = req.decision.approvals ?? [];
    for (const a of approvals) {
      if (a.bindingDigest !== current) {
        reasons.push(`godkendelse fra ${a.subject} er bundet til en anden ændring`);
      }
      if (a.verdict !== "approve") reasons.push(`afvisning fra ${a.subject}`);
      if (req.decision.requestedBy && a.subject === req.decision.requestedBy) reasons.push(`${a.subject} kan ikke godkende egen ændring`);
    }
    const unique = new Set(approvals.filter((a) => a.verdict === "approve" && a.bindingDigest === current).map((a) => a.subject));
    if (unique.size < (req.decision.requiredApprovals ?? 1)) {
      reasons.push(`kun ${unique.size} unikke godkendere (kræver ${req.decision.requiredApprovals ?? 1})`);
    }
    if (req.decision.expiresAt && clock() > Date.parse(req.decision.expiresAt)) reasons.push("anmodningen er udløbet");

    return { id, state: req.decision.state, mergeable: reasons.length === 0, reasons, bindingDigest: current, claims: checkClaims(req) };
  }

  /**
   * DKC-005 — verificér og forbrug en godkendelse lige før eksekvering.
   *
   * Handlingen der er ved at blive udført, skal give samme kanoniske binding
   * som den godkendte ændring (kunde, miljø, verbum, mål, diff-digest,
   * parametre, policy-version og udløb). Reservationen sker atomisk, så to
   * samtidige workers ikke kan udføre samme godkendte ændring to gange.
   */
  function authorizeExecutionRaw(id, descriptor = {}, principal) {
    requirePrincipal(principal, "authorizeExecution", id);
    let req;
    try {
      req = getRaw(id);
    } catch (err) {
      if (err.status === 404) return { ok: false, approvalId: id, reasons: [err.message] };
      throw err;
    }

    if (!principal || principal.kind !== "workload" || principal.id !== req.agent?.spiffeId) {
      denied("authorizeExecution", id, principal, new ApprovalError("kun den godkendte workload må forbruge anmodningen", 403));
    }
    authorizeRequest(req, principal, "authorizeExecution");
    if (typeof descriptor.executionId !== "string" || descriptor.executionId.length === 0) throw new ApprovalError("executionId mangler", 400);
    expireIfNeeded(req);
    const reasons = [...mergeCheckRaw(id).reasons];
    if (req.decision.consumed) {
      reasons.push(`godkendelsen er allerede forbrugt (executionId ${req.decision.consumed.executionId ?? "?"})`);
    }

    const expected = computeBindingDigest({
      tenantId: descriptor.tenantId ?? null,
      change: {
        environment: descriptor.environment ?? null,
        verb: descriptor.verb ?? null,
        targets: [descriptor.target],
        diff: { sha256: descriptor.diffSha256 ?? null },
        plan: descriptor.planSha256 ? { sha256: descriptor.planSha256 } : undefined,
        runbook: descriptor.runbookSha256 ? { sha256: descriptor.runbookSha256 } : undefined,
        producer: descriptor.producer ?? null,
        parameters: descriptor.parameters ?? null,
      },
      evidence: { policyEvaluation: { bundleVersion: descriptor.policyBundleVersion ?? null } },
      decision: { expiresAt: req.decision.expiresAt ?? null },
    });
    if (expected !== req.decision.binding?.digest) {
      reasons.push("handlingen matcher ikke den godkendte ændring (binding)");
    }
    if (reasons.length) {
      return { ok: false, approvalId: id, reasons, bindingDigest: expected, approvedBinding: req.decision.binding?.digest ?? null };
    }

    const at = new Date(clock()).toISOString();
    const claimRecord = {
      approvalId: id,
      executionId: descriptor.executionId ?? null,
      executorId: principal.id,
      tenantId: req.tenantId ?? null,
      at,
      bindingDigest: expected,
    };
    const claimed = typeof requestStore.claim === "function" ? requestStore.claim(id, claimRecord) : true;
    if (claimed === false) {
      return { ok: false, approvalId: id, reasons: ["godkendelsen er allerede reserveret af en anden worker"], bindingDigest: expected };
    }
    req.decision.consumed = claimRecord;
    persist(req);
    auditEvent("approval.consumed", req, principal.id, { executionId: descriptor.executionId ?? null, executorId: principal.id });
    return structuredClone({ ok: true, approvalId: id, bindingDigest: expected, consumed: claimRecord });
  }

  function renderView(req) {
    const diff = req.change?.diff ?? {};
    const stats = diff.summaryStats ?? {};
    const p = req.evidence?.policyEvaluation ?? {};
    const tests = req.evidence?.tests ?? {};
    const dryRun = req.evidence?.dryRun ?? {};
    const scans = req.evidence?.scans ?? [];
    const assessment = req.agentAssessment ?? {};
    const claims = checkClaims(req);
    const merge = mergeCheckRaw(req.id);
    const claimRows = (assessment.claims ?? [])
      .map((c) => {
        const mismatch = claims.mismatches.find((m) => m.evidenceRef === c.evidenceRef);
        return `<tr class="${mismatch ? "bad" : "good"}"><td>${escapeHtml(c.statement)}</td><td><code>${escapeHtml(c.evidenceRef)}</code></td><td>${escapeHtml(String(c.value))}</td><td>${mismatch ? "AFVIGER" : "matcher"}</td></tr>`;
      })
      .join("");
    const approvalRows = (req.decision.approvals ?? [])
      .map((a) => `<tr><td>${escapeHtml(a.subject)}</td><td>${escapeHtml(a.verdict)}</td><td><code>${escapeHtml((a.bindingDigest ?? "").slice(0, 12))}…</code></td><td>${escapeHtml(a.at)}</td></tr>`)
      .join("");
    const binding = req.decision.binding ?? {};
    return `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><title>Approval ${escapeHtml(req.id)}</title>
<style>
 body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
 .panel{border:1px solid #ccc;border-radius:8px;padding:1rem}
 .machine{border-color:#2e7d32;background:#f4fbf4}
 .prose{border-color:#b71c1c;background:#fdf4f4}
 .badge{display:inline-block;padding:.15rem .5rem;border-radius:999px;font-size:.75rem;color:#fff}
 .machine .badge{background:#2e7d32}
 .prose .badge{background:#b71c1c}
 table{border-collapse:collapse;width:100%}
 td,th{border-bottom:1px solid #ddd;padding:.3rem;text-align:left;font-size:.9rem}
 tr.bad{background:#ffe0e0}
 tr.good{background:#e8f5e9}
 .diff{font-family:ui-monospace,monospace;background:#f5f5f5;padding:.5rem;border-radius:6px}
</style></head><body>
<h1>Godkendelse <code>${escapeHtml(req.id)}</code></h1>
<p>Status: <strong>${escapeHtml(req.decision.state)}</strong> · kræver ${req.decision.requiredApprovals} godkendelse(r) · udløber ${escapeHtml(req.decision.expiresAt ?? "—")}</p>
<p>Kunde: <strong>${escapeHtml(req.tenantId ?? "—")}</strong> · anmodet af ${escapeHtml(req.decision.requestedBy ?? "—")} · mergeable: <strong>${merge.mergeable ? "ja" : "nej"}</strong></p>
${merge.reasons.length ? `<p>Blokeringer: ${merge.reasons.map((r) => escapeHtml(r)).join("; ")}</p>` : ""}
<div class="diff">${escapeHtml(diff.uri ?? "")}<br>files ${stats.filesChanged ?? "?"} · +${stats.linesAdded ?? "?"} / -${stats.linesRemoved ?? "?"} · sha256 ${escapeHtml(diff.sha256 ?? "")}<br>binding sha256 ${escapeHtml(binding.digest ?? "—")}</div>
<div class="grid">
  <section class="panel machine"><span class="badge">MASKINE · EVIDENS</span>
    <h2>Policy</h2><p>${escapeHtml(p.pdp ?? "")} · bundle ${escapeHtml(p.bundleVersion ?? "")} · <strong>${escapeHtml(p.decision ?? "")}</strong></p>
    <h2>Tests</h2><p>${escapeHtml(tests.status ?? "?")} (${tests.passed ?? 0} pass, ${tests.failed ?? 0} fail)</p>
    <h2>Dry-run</h2><p>${escapeHtml(dryRun.status ?? "?")} (exit ${dryRun.exitCode ?? "?"})</p>
    <h2>Scans</h2><ul>${scans.map((s) => `<li>${escapeHtml(s.tool)}: ${escapeHtml(s.status)} (crit ${s.critical ?? 0}, high ${s.high ?? 0})</li>`).join("") || "<li>ingen</li>"}</ul>
    <h2>Rollback</h2><p>${escapeHtml(req.rollback?.method ?? "?")} · testet: ${req.rollback?.tested ? "ja" : "nej"}</p>
  </section>
  <section class="panel prose"><span class="badge">AGENT · PROSA (ikke evidens)</span>
    <h2>Vurdering</h2><p>${escapeHtml(assessment.rationale ?? "")}</p>
    <p><em>Nulhypotese:</em> ${escapeHtml(assessment.doNothingConsequence ?? "")}</p>
    <p>Confidence: ${assessment.confidence ?? "?"}</p>
    <h2>Usikkerheder</h2><ul>${(assessment.uncertainties ?? []).map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul>
    <h2>Ikke undersøgt</h2><ul>${(assessment.notChecked ?? []).map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul>
  </section>
</div>
<h2>Godkendelser</h2>
<table><thead><tr><th>Identitet</th><th>Verdict</th><th>Binding</th><th>Tid</th></tr></thead><tbody>${approvalRows || "<tr><td colspan=\"4\">ingen</td></tr>"}</tbody></table>
<h2>Påstande mod evidens ${claims.ok ? "(alle matcher)" : "(AFVIGELSER)"}</h2>
<table><thead><tr><th>Påstand</th><th>Evidenssti</th><th>Forventet</th><th>Resultat</th></tr></thead><tbody>${claimRows}</tbody></table>
</body></html>`;
  }

  function respond(res, code, body, type = "application/json") {
    res.writeHead(code, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }

  async function principalFromHttp(req, headers) {
    if (!authenticator) throw new ApprovalError("identitetsverificering er ikke konfigureret", 503);
    return authenticator.authenticate(headers.authorization, headers, {
      remoteAddress: req.socket?.remoteAddress ?? null,
      peerCertificate: typeof req.socket?.getPeerCertificate === "function" ? safePeerCertificate(req.socket) : null,
    });
  }

  /** DKC-006: en godkendelse kan kun læses af dens egen kunde (eller scopet platformrolle). */
  function assertRequestTenant(req, principal, approvalId) {
    return authorizedRequest(approvalId, principal, "read");
  }

  function get(id, { principal } = {}) {
    return structuredClone(authorizedRequest(id, principal, "read"));
  }

  function list({ principal, tenantId } = {}) {
    requirePrincipal(principal, "list");
    const target = tenantId ?? principal.tenantId;
    if (!target) denied("list", null, principal, new ApprovalError("tenant-scope mangler", 403));
    let access;
    try { access = authorizeTenantAccess({ principal, tenantId: target }); }
    catch (err) { denied("list", null, principal, new ApprovalError(err.message, 403)); }
    if (!access.allowed) denied("list", null, principal, new ApprovalError(access.reason, 403));
    return [...requests.values()].filter((r) => r.tenantId === target).map((r) => ({ id: r.id, state: r.decision.state }));
  }

  function mergeCheck(id, { principal } = {}) {
    authorizedRequest(id, principal, "mergeCheck");
    return structuredClone(mergeCheckRaw(id));
  }

  function authorizeExecution(id, descriptor = {}, { principal } = {}) {
    return authorizeExecutionRaw(id, descriptor, principal);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const viewMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/view$/);
    const mergeMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/merge-check$/);
    const decisionMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/decisions$/);
    const authorizeMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/authorize$/);
    const revokeMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/revoke$/);
    const getMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);

    if (req.method === "GET" && url.pathname === "/v1/approvals") {
      return (async () => {
        try {
          const principal = await principalFromHttp(req, req.headers);
          const tenantId = url.searchParams.get("tenantId") ?? undefined;
          return respond(res, 200, { requests: list({ principal, tenantId }) });
        } catch (err) { return respond(res, err.status ?? 500, { error: err.message, code: err.code }); }
      })();
    }
    if (req.method === "POST" && url.pathname === "/v1/approvals") {
      return readJson(req, async (body) => {
        const principal = await principalFromHttp(req, req.headers);
        return respond(res, 201, createPublic(body, principal));
      }, res);
    }
    if (req.method === "GET" && viewMatch) {
      return (async () => {
        try {
          const principal = await principalFromHttp(req, req.headers);
          const request = assertRequestTenant(null, principal, viewMatch[1]);
          return respond(res, 200, renderView(structuredClone(request)), "text/html; charset=utf-8");
        } catch (err) {
          return respond(res, err.status ?? 500, { error: err.message, code: err.code });
        }
      })();
    }
    if (req.method === "GET" && mergeMatch) {
      return (async () => {
        try {
          const principal = await principalFromHttp(req, req.headers);
          assertRequestTenant(req, principal, mergeMatch[1]);
          return respond(res, 200, mergeCheck(mergeMatch[1], { principal }));
        } catch (err) {
          return respond(res, err.status ?? 500, { error: err.message, code: err.code });
        }
      })();
    }
    if (req.method === "POST" && decisionMatch) {
      return readJson(req, async (body) => {
        const principal = await principalFromHttp(req, req.headers);
        return respond(res, 200, decide(decisionMatch[1], { verdict: body.verdict, comment: body.comment, changeDigest: body.changeDigest, principal }));
      }, res);
    }
    if (req.method === "POST" && authorizeMatch) {
      return readJson(req, async (body) => {
        const principal = await principalFromHttp(req, req.headers);
        return respond(res, 200, authorizeExecution(authorizeMatch[1], body, { principal }));
      }, res);
    }
    if (req.method === "POST" && revokeMatch) {
      return readJson(req, async (body) => {
        const principal = await principalFromHttp(req, req.headers);
        return respond(res, 200, revoke(revokeMatch[1], { reason: body.reason, principal }));
      }, res);
    }
    if (req.method === "GET" && getMatch) {
      return (async () => {
        try {
          const principal = await principalFromHttp(req, req.headers);
          assertRequestTenant(req, principal, getMatch[1]);
          return respond(res, 200, get(getMatch[1], { principal }));
        } catch (err) {
          return respond(res, err.status ?? 500, { error: err.message, code: err.code });
        }
      })();
    }
    respond(res, 404, { error: "not found" });
  });

  // The composition root receives raw persistence access separately from the
  // public service. Never return this capability as a property of the service.
  const trustedCapability = Object.freeze({
    create: (payload) => create(payload, { principal: INTERNAL }),
    get: getRaw,
    mergeCheck: mergeCheckRaw,
    authorizeExecution: (id, descriptor, principal) => authorizeExecutionRaw(id, descriptor, principal),
    store: requestStore,
    audit,
    verifyAudit: () => audit.verifyChain(),
  });
  if (typeof onTrustedCapability === "function") onTrustedCapability(trustedCapability);

  return {
    create: (payload, context) => createPublic(payload, context?.principal),
    get,
    decide,
    amend,
    revoke,
    withdraw,
    mergeCheck,
    authorizeExecution,
    computeBinding,
    list,
    renderView: (id, { principal } = {}) => renderView(get(id, { principal })),
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function readJson(req, handler, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      await handler(parsed);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(err.status ?? 500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });
}

function safePeerCertificate(socket) {
  try {
    const cert = socket.getPeerCertificate();
    return cert && Object.keys(cert).length > 0 ? cert : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
