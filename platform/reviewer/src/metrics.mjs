import { createServer } from "node:http";

/**
 * Reviewer-effektmåling.
 *
 * Uden disse tal ved man ikke, om review-laget gør gavn eller skaber falsk
 * tryghed. Vi måler to ting:
 *
 * - flaggedButApproved: revieweren fandt noget, men mennesket godkendte alligevel.
 *   Friction — eller en fangst mennesket overså.
 * - greenButBroke: revieweren gav grønt lys, og ændringen brækkede bagefter.
 *   Falsk negativ. Det er det farlige tal.
 */
export function createReviewerMetrics({ clock = () => Date.now() } = {}) {
  const reviews = new Map();
  const decisions = new Map();
  const outcomes = new Map();

  const record = (map, input) => {
    if (!input?.requestId) throw new Error("requestId kræves");
    map.set(input.requestId, { ...input, at: input.at ?? new Date(clock()).toISOString() });
    return map.get(input.requestId);
  };

  const recordReviewerVerdict = (input) => record(reviews, input);
  const recordHumanDecision = (input) => record(decisions, input);
  const recordOutcome = (input) => record(outcomes, input);

  function snapshot() {
    let flagged = 0;
    let noObjection = 0;
    let humanApproved = 0;
    let humanRejected = 0;
    let flaggedButApproved = 0;
    let flaggedAndRejected = 0;
    let greenButBroke = 0;

    for (const [id, review] of reviews) {
      const decision = decisions.get(id);
      const outcome = outcomes.get(id);
      if (review.verdict === "no-objection") noObjection += 1;
      else flagged += 1;
      if (decision?.verdict === "approve") humanApproved += 1;
      if (decision?.verdict === "reject") humanRejected += 1;
      if (review.verdict !== "no-objection" && decision?.verdict === "approve") flaggedButApproved += 1;
      if (review.verdict !== "no-objection" && decision?.verdict === "reject") flaggedAndRejected += 1;
      if (review.verdict === "no-objection" && outcome?.broke === true) greenButBroke += 1;
    }

    return {
      reviewed: reviews.size,
      flagged,
      noObjection,
      humanApproved,
      humanRejected,
      flaggedButApproved,
      flaggedAndRejected,
      greenButBroke,
      falseNegativeRate: noObjection > 0 ? greenButBroke / noObjection : null,
      frictionRate: flagged > 0 ? flaggedButApproved / flagged : null,
      reviewerRejectAgreement: reviews.size > 0 ? flaggedAndRejected / reviews.size : null,
    };
  }

  function renderDashboard() {
    const s = snapshot();
    const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
    return `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><title>Reviewer-effekt</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:900px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
.card{border:1px solid #ccc;border-radius:8px;padding:1rem}
.card .n{font-size:2rem;font-weight:700}
.warn{border-color:#b71c1c;background:#fdf4f4}
.ok{border-color:#2e7d32;background:#f4fbf4}</style></head><body>
<h1>Reviewer-effektmåling</h1>
<p>${s.reviewed} reviewede forslag.</p>
<div class="cards">
  <div class="card"><div class="n">${s.flagged}</div>flagget eller afvist af reviewer</div>
  <div class="card"><div class="n">${s.flaggedButApproved}</div>fanget, men godkendt af menneske<br>friction ${pct(s.frictionRate)}</div>
  <div class="card ${s.greenButBroke > 0 ? "warn" : "ok"}"><div class="n">${s.greenButBroke}</div>grønt lys, men brækkede bagefter<br>falsk negativ ${pct(s.falseNegativeRate)}</div>
</div>
<h2>Detaljer</h2>
<ul>
  <li>Mennesket godkendte: ${s.humanApproved}</li>
  <li>Mennesket afviste: ${s.humanRejected}</li>
  <li>Reviewer og menneske enige om afvisning: ${s.flaggedAndRejected}</li>
</ul>
<p><em>Uden disse tal ved man ikke, om review-laget gør gavn eller skaber falsk tryghed.</em></p>
</body></html>`;
  }

  function respond(res, code, body, type = "application/json") {
    res.writeHead(code, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      return respond(res, 200, renderDashboard(), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/v1/metrics") {
      return respond(res, 200, snapshot());
    }
    if (req.method === "POST" && ["/v1/reviews", "/v1/decisions", "/v1/outcomes"].includes(url.pathname)) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const payload = JSON.parse(body || "{}");
          if (url.pathname === "/v1/reviews") recordReviewerVerdict(payload);
          else if (url.pathname === "/v1/decisions") recordHumanDecision(payload);
          else recordOutcome(payload);
          return respond(res, 201, snapshot());
        } catch (err) {
          return respond(res, 400, { error: err.message });
        }
      });
      return;
    }
    respond(res, 404, { error: "not found" });
  });

  return {
    recordReviewerVerdict,
    recordHumanDecision,
    recordOutcome,
    snapshot,
    renderDashboard,
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
