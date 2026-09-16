import { createServer } from "node:http";
import { checkClaims } from "./claims.mjs";

export class ApprovalError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
  }
}

/**
 * Approval-service.
 *
 * Håndhæver approver-grupper, udløb og træningskrav. En A3-anmodning kan ikke
 * merges uden menneskelig godkendelse. `evidence` (maskine) og `agentAssessment`
 * (prosa) holdes adskilt — også i den renderede visning.
 */
export function createApprovalService({ trainingRegistry = () => [], clock = () => Date.now(), onDecision = () => {} } = {}) {
  const requests = new Map();

  function create(payload) {
    for (const field of ["id", "agent", "change", "evidence", "agentAssessment", "decision"]) {
      if (payload?.[field] === undefined) throw new ApprovalError(`manglende felt '${field}'`, 400);
    }
    const stored = structuredClone(payload);
    stored.decision.state ??= "pending";
    stored.decision.approvals ??= [];
    requests.set(stored.id, stored);
    return stored;
  }

  function get(id) {
    const req = requests.get(id);
    if (!req) throw new ApprovalError("anmodning findes ikke", 404);
    if (req.decision.state === "pending" && req.decision.expiresAt && clock() > Date.parse(req.decision.expiresAt)) {
      req.decision.state = "expired";
    }
    return req;
  }

  function decide(id, { subject, groups = [], verdict, comment, completedTrainingModules = [], at } = {}) {
    const req = get(id);
    if (req.decision.state === "expired") throw new ApprovalError("anmodningen er udløbet", 410);
    if (req.decision.state !== "pending") throw new ApprovalError(`anmodningen er allerede ${req.decision.state}`, 409);
    if (!subject) throw new ApprovalError("manglende approver-identitet", 401);
    if (!["approve", "reject"].includes(verdict)) throw new ApprovalError("verdict skal være approve eller reject", 400);

    const eligible = req.decision.eligibleGroups ?? [];
    if (eligible.length && !groups.some((g) => eligible.includes(g))) {
      throw new ApprovalError("approver er ikke i en godkendt gruppe", 403);
    }

    const required = req.decision.requiredTrainingModules ?? [];
    const completed = new Set(completedTrainingModules.length ? completedTrainingModules : trainingRegistry(subject));
    const missing = required.filter((m) => !completed.has(m));
    if (missing.length) throw new ApprovalError(`godkender mangler træningsmoduler: ${missing.join(", ")}`, 428);

    const record = {
      subject,
      at: at ?? new Date(clock()).toISOString(),
      verdict,
      ...(comment ? { comment } : {}),
      ...(required.length ? { trainingVerified: true } : {}),
    };
    req.decision.approvals.push(record);

    if (verdict === "reject") {
      req.decision.state = "rejected";
    } else {
      const approvals = req.decision.approvals.filter((a) => a.verdict === "approve").length;
      if (approvals >= req.decision.requiredApprovals) req.decision.state = "approved";
    }
    onDecision({ id, state: req.decision.state, record });
    return req;
  }

  /** A3 kan ikke merges uden menneske: kun 'approved' er mergeable. */
  function mergeCheck(id) {
    const req = get(id);
    return { id, state: req.decision.state, mergeable: req.decision.state === "approved", claims: checkClaims(req) };
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
    const claimRows = (assessment.claims ?? [])
      .map((c) => {
        const mismatch = claims.mismatches.find((m) => m.evidenceRef === c.evidenceRef);
        return `<tr class="${mismatch ? "bad" : "good"}"><td>${escapeHtml(c.statement)}</td><td><code>${escapeHtml(c.evidenceRef)}</code></td><td>${escapeHtml(String(c.value))}</td><td>${mismatch ? "AFVIGER" : "matcher"}</td></tr>`;
      })
      .join("");
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
<div class="diff">${escapeHtml(diff.uri ?? "")}<br>files ${stats.filesChanged ?? "?"} · +${stats.linesAdded ?? "?"} / -${stats.linesRemoved ?? "?"} · sha256 ${escapeHtml(diff.sha256 ?? "")}</div>
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
<h2>Påstande mod evidens ${claims.ok ? "(alle matcher)" : "(AFVIGELSER)"}</h2>
<table><thead><tr><th>Påstand</th><th>Evidenssti</th><th>Forventet</th><th>Resultat</th></tr></thead><tbody>${claimRows}</tbody></table>
</body></html>`;
  }

  function respond(res, code, body, type = "application/json") {
    res.writeHead(code, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const viewMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/view$/);
    const mergeMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/merge-check$/);
    const decisionMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/decisions$/);
    const getMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);

    if (req.method === "GET" && url.pathname === "/v1/approvals") {
      return respond(res, 200, { requests: [...requests.values()].map((r) => ({ id: r.id, state: r.decision.state })) });
    }
    if (req.method === "POST" && url.pathname === "/v1/approvals") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          return respond(res, 201, create(JSON.parse(body)));
        } catch (err) {
          return respond(res, err.status ?? 400, { error: err.message });
        }
      });
      return;
    }
    if (req.method === "GET" && viewMatch) {
      try {
        return respond(res, 200, renderView(get(viewMatch[1])), "text/html; charset=utf-8");
      } catch (err) {
        return respond(res, err.status ?? 500, { error: err.message });
      }
    }
    if (req.method === "GET" && mergeMatch) {
      try {
        return respond(res, 200, mergeCheck(mergeMatch[1]));
      } catch (err) {
        return respond(res, err.status ?? 500, { error: err.message });
      }
    }
    if (req.method === "POST" && decisionMatch) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          return respond(res, 200, decide(decisionMatch[1], JSON.parse(body)));
        } catch (err) {
          return respond(res, err.status ?? 500, { error: err.message });
        }
      });
      return;
    }
    if (req.method === "GET" && getMatch) {
      try {
        return respond(res, 200, get(getMatch[1]));
      } catch (err) {
        return respond(res, err.status ?? 500, { error: err.message });
      }
    }
    respond(res, 404, { error: "not found" });
  });

  return {
    requests,
    create,
    get,
    decide,
    mergeCheck,
    renderView,
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
