/**
 * DKC-052 — kørsel og persistering af overtagelsesøvelsen.
 *
 * Øvelsen er deterministisk og bærer `measured: false`. Menneskelige trin
 * forbliver `pending`, indtil et navngivet menneske faktisk har udført dem.
 * Derfor kan den kanoniske kørsel ikke give `pass` — gaten er `awaiting-human`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRecoveryDrill } from "./takeover.mjs";
import { createTakeoverProbes } from "./takeover-probes.mjs";
import { renderRecoveryDrillReport, renderTakeoverPlan } from "./takeover-report.mjs";

export const TAKEOVER_PLAN_PATH = "continuity/takeover-plan.json";
export const DRILL_REPORT_PATH = "continuity/report/recovery-drill-report.json";
export const DRILL_DOC_PATH = "docs/continuity/recovery-drill-report.md";
export const PLAN_DOC_PATH = "docs/continuity/takeover-plan.md";

export function loadTakeoverPlan(root) {
  return JSON.parse(readFileSync(join(root, TAKEOVER_PLAN_PATH), "utf8"));
}

/**
 * Byg den samlede øvelsesrapport: kør hvert scenarie og opsummer gaten.
 * Gaten kan ikke blive `pass`, så længe et påkrævet menneskeligt trin afventer.
 */
export async function buildTakeoverSuite(root, { plan = null, probes = null, clock = null } = {}) {
  const resolvedPlan = plan ?? loadTakeoverPlan(root);
  // Deterministisk kørsel: den kanoniske rapport må kunne genskabes byte-identisk.
  const fixedClock = clock ?? (() => Date.parse("2026-09-29T08:00:00Z"));
  const resolvedProbes = probes ?? createTakeoverProbes(root, { clock: fixedClock });
  const drill = createRecoveryDrill({ plan: resolvedPlan, probes: resolvedProbes, clock: fixedClock, root });
  const drills = await drill.runAll();

  const machineSteps = drills.reduce((n, d) => n + d.steps.filter((s) => s.kind === "machine").length, 0);
  const humanSteps = drills.reduce((n, d) => n + d.steps.filter((s) => s.kind === "human").length, 0);
  const humanPending = drills.reduce((n, d) => n + d.steps.filter((s) => s.kind === "human" && s.status === "pending").length, 0);
  const escalationsToHumans = drills.reduce((n, d) => n + d.steps.reduce((m, s) => m + (s.escalation ?? []).length, 0), 0);

  const reasons = [];
  for (const d of drills) {
    if (d.status === "blocked") reasons.push(`${d.scenarioId}: ${d.gate.reasons.join("; ")}`);
    else if (d.status === "awaiting-human") reasons.push(`${d.scenarioId}: afventer menneskelig handling (${d.gate.reasons.join("; ")})`);
  }
  const blocked = drills.some((d) => d.status === "blocked");
  const awaiting = drills.some((d) => d.status === "awaiting-human");
  const gateStatus = blocked ? "blocked" : awaiting ? "awaiting-human" : "pass";

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "RecoveryDrillSuite",
    generatedAt: resolvedPlan.metadata?.lastReviewed ?? "2026-09-29",
    planRef: resolvedPlan.metadata?.name ?? "takeover-plan",
    planVersion: resolvedPlan.metadata?.version ?? "0.0.0",
    measured: false,
    reason: "Deterministisk øvelse på de rigtige artefakter og moduler. Menneskelige out-of-band-trin forbliver AFVENTER, og en målt øvelse på levende hosts/kanaler er NOT RUN.",
    agentCanApprove: false,
    drills,
    summary: {
      total: drills.length,
      validated: drills.filter((d) => d.status === "validated").length,
      awaitingHuman: drills.filter((d) => d.status === "awaiting-human").length,
      blocked: drills.filter((d) => d.status === "blocked").length,
      machineSteps,
      humanSteps,
      humanPending,
      escalationsToHumans,
    },
    gate: { status: gateStatus, reasons },
  };
}

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export async function writeTakeoverArtifacts(root) {
  const suite = await buildTakeoverSuite(root);
  writeFile(root, DRILL_REPORT_PATH, JSON.stringify(suite, null, 2) + "\n");
  writeFile(root, PLAN_DOC_PATH, renderTakeoverPlan(loadTakeoverPlan(root)));
  writeFile(root, DRILL_DOC_PATH, renderRecoveryDrillReport(suite));
  return suite;
}
