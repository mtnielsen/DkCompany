/**
 * DKC-052 — enhedstest af overtagelsesøvelsen.
 *
 * Dækker de fem acceptkriterier direkte i koden:
 *   1. et menneske kan overtage uden en fungerende model/portal (menneskelige
 *      out-of-band-trin driver forløbet),
 *   2. ingen ansvarskæde ender hos en agent; timeout eskalerer til et menneske,
 *   3. gendannelse og failback har en dokumenteret ejerbeslutning og målt
 *      dataintegritet,
 *   4. kritiske incidents lukkes først efter servicevalidering og menneskelig
 *      accept,
 *   5. den valgte HA-/immutable-/self-healing-profil indgår og testes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRecoveryDrill, escalationFor, recoveryDrillProblems, takeoverPlanProblems } from "../src/takeover.mjs";
import { buildTakeoverSuite } from "../src/takeover-run.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const plan = JSON.parse(readFileSync(join(root, "continuity/takeover-plan.json"), "utf8"));

const PROBE_NAMES = ["verify-artifacts", "profile-choice", "ai-offline", "iam-loss", "restore-integrity", "failback-integrity", "service-validation"];

function passingProbes() {
  const probes = {};
  for (const name of PROBE_NAMES) {
    probes[name] = async () => ({
      status: "pass",
      result: `probe '${name}' bestod`,
      at: "2026-09-29T08:00:00Z",
      artifactRef: "x",
      artifactDigest: "sha256:abc",
      measurements: { dataIntegrityOk: true, restoreVerified: true, failbackVerified: true, rpoMinutes: 0, rtoMinutes: 0.5, rpoTargetMinutes: 1, rtoTargetMinutes: 1 },
    });
  }
  return probes;
}

function evidenceFor(scenarioId, { wrongOperator = false } = {}) {
  const scenario = plan.drills.scenarios.find((s) => s.id === scenarioId);
  const evidence = {};
  for (const step of scenario.steps) {
    if (step.kind !== "human") continue;
    const owner = plan.roles[step.ownerRole];
    evidence[step.id] = {
      by: wrongOperator ? { subject: "oidc|karl.kristensen", name: "Karl Kristensen", role: "Platform Engineer" } : owner,
      at: "2026-09-29T08:00:00Z",
      evidenceRef: `evidence/${step.id}.json`,
      decision: step.evidenceKind === "owner-decision" ? "approved" : step.evidenceKind === "incident-acceptance" ? "accepted" : "done",
    };
  }
  return evidence;
}

/* 1. Mennesket kan overtage; menneskelige trin er aldrig automatisk pass. */
test("menneskelige out-of-band-trin forbliver afventende i den deterministiske kørsel", async () => {
  const drill = createRecoveryDrill({ plan, probes: passingProbes(), root });
  const result = await drill.runScenario("single-server");
  const humans = result.steps.filter((s) => s.kind === "human");
  assert.ok(humans.length > 0);
  assert.equal(humans.every((s) => s.status === "pending"), true);
  assert.equal(result.status, "awaiting-human");
  assert.equal(result.gate.status, "awaiting-human");
  assert.equal(result.agentCanApprove, false);
  assert.equal(result.requiresHumanAcceptance, true);
});

/* 2. Ingen ansvarskæde ender hos en agent; timeout eskalerer til et menneske. */
test("en timeout eskalerer gennem en kæde af navngivne mennesker", async () => {
  const drill = createRecoveryDrill({ plan, probes: passingProbes(), root });
  const result = await drill.runScenario("single-server");
  const pending = result.steps.filter((s) => s.kind === "human" && s.status === "pending");
  assert.ok(pending.length > 0);
  for (const step of pending) {
    assert.ok(step.escalation.length > 0, `trinnet '${step.id}' skal eskalere`);
    for (const e of step.escalation) {
      assert.match(e.to.subject, /^oidc\|/);
      assert.ok(e.to.name);
    }
  }
  const chain = escalationFor(plan, { ackMinutes: 30 });
  assert.equal(chain[chain.length - 1].to.subject, "oidc|cecilia.christensen");
  assert.equal(result.steps.every((s) => s.owner === null || /^oidc\|/.test(s.owner.subject)), true);
});

/* 3+4+5. Fuld menneskelig evidens giver en valideret øvelse med ejerbeslutninger. */
test("med menneskelig evidens bliver øvelsen valideret med ejerbeslutning og målt dataintegritet", async () => {
  const drill = createRecoveryDrill({ plan, probes: passingProbes(), root });
  const result = await drill.runScenario("ha", { humanEvidence: evidenceFor("ha") });
  assert.equal(result.status, "validated", JSON.stringify(result.gate));
  assert.equal(result.gate.status, "pass");
  assert.equal(result.measurements.dataIntegrityOk, true);
  assert.equal(result.measurements.failbackVerified, true);
  const phases = new Set(result.decisions.map((d) => d.phase));
  assert.ok(phases.has("restore"));
  assert.ok(phases.has("failback"));
  assert.ok(phases.has("validation"));
  assert.equal(recoveryDrillProblems(result).length, 0, JSON.stringify(recoveryDrillProblems(result)));
});

/* Acceptkriterium: en kritisk incident lukkes først efter menneskelig accept. */
test("øvelsen valideres ikke uden den menneskelige incidentaccept", async () => {
  const drill = createRecoveryDrill({ plan, probes: passingProbes(), root });
  const evidence = evidenceFor("single-server");
  delete evidence["human-acceptance"];
  const result = await drill.runScenario("single-server", { humanEvidence: evidence });
  assert.equal(result.status, "awaiting-human");
  const acceptance = result.steps.find((s) => s.evidenceKind === "incident-acceptance");
  assert.equal(acceptance.status, "pending");
});

/* Manglende evidens/probe blokerer i isolation. */
test("en manglende probe blokerer øvelsen", async () => {
  const drill = createRecoveryDrill({ plan, probes: {}, root });
  const result = await drill.runScenario("single-server");
  assert.equal(result.status, "blocked");
  assert.ok(result.gate.reasons.some((r) => r.includes("mangler probe")));
  assert.equal(recoveryDrillProblems(result).length, 0);
});

test("et fejlet påkrævet trin stopper efterfølgende trin", async () => {
  const drill = createRecoveryDrill({ plan, probes: passingProbes(), root });
  const result = await drill.runScenario("single-server", { injectedFailures: { "restore-integrity": "diskfejl" } });
  assert.equal(result.status, "blocked");
  const failed = result.steps.find((s) => s.id === "restore-integrity");
  assert.equal(failed.status, "fail");
  const later = result.steps.filter((s) => s.required !== false && s.status === "not-run");
  assert.ok(later.length > 0, "efterfølgende påkrævede trin skal være IKKE KØRT");
});

test("en forkert operatør afvises", async () => {
  const drill = createRecoveryDrill({ plan, probes: passingProbes(), root });
  const result = await drill.runScenario("single-server", { humanEvidence: evidenceFor("single-server", { wrongOperator: true }) });
  assert.equal(result.status, "blocked");
  assert.ok(result.gate.reasons.some((r) => r.includes("operatør") || r.includes("rolle")));
});

/* Plan-semantik. */
test("planen kræver navngivne mennesker i alle roller og begge scenariekinds", () => {
  assert.equal(takeoverPlanProblems(plan, { root }).length, 0);
  const broken = structuredClone(plan);
  broken.roles.onCall = { subject: "agent|robot", name: "Robot", role: "agent" };
  assert.ok(takeoverPlanProblems(broken).length > 0);
  const kinds = new Set(plan.drills.scenarios.map((s) => s.kind));
  assert.ok(kinds.has("single-server"));
  assert.ok(kinds.has("ha"));
});

/* Negativ kontrol: semantikken afviser et automatisk bestået menneskeligt trin. */
test("semantikken afviser et automatisk bestået menneskeligt trin", async () => {
  const suite = await buildTakeoverSuite(root, { plan });
  const base = suite.drills[0];
  const auto = {
    ...base,
    status: "validated",
    gate: { status: "pass", reasons: [] },
    measurements: { ...base.measurements, dataIntegrityOk: true },
    steps: base.steps.map((s) => (s.kind === "human" && s.status === "pending" ? { ...s, status: "pass", owner: null, at: "2026-09-29T08:00:00Z" } : s)),
  };
  assert.ok(recoveryDrillProblems(auto).length > 0);
});
