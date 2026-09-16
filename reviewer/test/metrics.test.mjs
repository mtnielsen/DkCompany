import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewerMetrics } from "../src/metrics.mjs";

test("måler falske negativer og friction", () => {
  const m = createReviewerMetrics();
  // 1: reviewer grønt, menneske godkender, brækkede bagefter → falsk negativ
  m.recordReviewerVerdict({ requestId: "1", verdict: "no-objection", reviewerRef: "r" });
  m.recordHumanDecision({ requestId: "1", verdict: "approve" });
  m.recordOutcome({ requestId: "1", broke: true });
  // 2: reviewer flagger, menneske godkender → friction
  m.recordReviewerVerdict({ requestId: "2", verdict: "flag", reviewerRef: "r" });
  m.recordHumanDecision({ requestId: "2", verdict: "approve" });
  // 3: reviewer afviser, menneske afviser → enighed
  m.recordReviewerVerdict({ requestId: "3", verdict: "reject", reviewerRef: "r" });
  m.recordHumanDecision({ requestId: "3", verdict: "reject" });

  const s = m.snapshot();
  assert.equal(s.reviewed, 3);
  assert.equal(s.flagged, 2);
  assert.equal(s.noObjection, 1);
  assert.equal(s.greenButBroke, 1);
  assert.equal(s.falseNegativeRate, 1);
  assert.equal(s.flaggedButApproved, 1);
  assert.equal(s.frictionRate, 0.5);
  assert.equal(s.flaggedAndRejected, 1);
});

test("dashboardet viser tallene", () => {
  const m = createReviewerMetrics();
  m.recordReviewerVerdict({ requestId: "1", verdict: "no-objection" });
  m.recordHumanDecision({ requestId: "1", verdict: "approve" });
  m.recordOutcome({ requestId: "1", broke: true });
  const html = m.renderDashboard();
  assert.match(html, /Reviewer-effektmåling/);
  assert.match(html, /falsk negativ/);
  assert.match(html, /100\.0%/);
});

test("metrics kan læses over HTTP", async () => {
  const m = createReviewerMetrics();
  const port = await m.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "x", verdict: "flag" }),
    });
    assert.equal(res.status, 201);
    const metrics = await (await fetch(`http://127.0.0.1:${port}/v1/metrics`)).json();
    assert.equal(metrics.reviewed, 1);
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /Reviewer-effektmåling/);
  } finally {
    await m.close();
  }
});
