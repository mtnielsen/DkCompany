#!/usr/bin/env node
import { createReviewerMetrics } from "./metrics.mjs";

const m = createReviewerMetrics();
// Lidt demodata, så dashboardet viser noget ved opstart.
m.recordReviewerVerdict({ requestId: "demo-1", verdict: "no-objection", reviewerRef: "dummy-ok-reviewer" });
m.recordHumanDecision({ requestId: "demo-1", verdict: "approve" });
m.recordOutcome({ requestId: "demo-1", broke: true });
m.recordReviewerVerdict({ requestId: "demo-2", verdict: "flag", reviewerRef: "dummy-ok-reviewer" });
m.recordHumanDecision({ requestId: "demo-2", verdict: "approve" });

const port = await m.listen(Number(process.argv[2] ?? 8484));
console.log(`Reviewer-effektmåling: http://127.0.0.1:${port}/`);
console.log(`  metrics: http://127.0.0.1:${port}/v1/metrics`);
