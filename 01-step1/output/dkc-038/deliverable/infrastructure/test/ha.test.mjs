import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  haClusterProblems,
  quorumFor,
  assessQuorum,
  capacityAfterLoss,
  voluntaryDrain,
  hardCrash,
  runFailoverDrill,
  haServiceClassProblems,
  HA_PROFILE_REF,
} from "../src/ha.mjs";
import { loadServiceClasses } from "../../continuity/src/classes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const base = JSON.parse(readFileSync(join(repoRoot, "infrastructure", "ha-plan.json"), "utf8"));
const clone = () => structuredClone(base);
const NOW = Date.parse("2025-09-01T08:00:00Z");

test("den kanoniske HA-plan validerer uden semantiske problemer", () => {
  assert.equal(haClusterProblems(base).length, 0);
  assert.equal(base.hostingProfileRef, HA_PROFILE_REF);
});

test("quorum-matematik: flertal af tre er to", () => {
  assert.equal(quorumFor(3), 2);
  assert.equal(quorumFor(5), 3);
});

test("et tab af ét af tre medlemmer bevarer quorum, writes og én leder", () => {
  const state = assessQuorum(base, { down: ["cp-1"] });
  assert.equal(state.healthy, 2);
  assert.equal(state.hasQuorum, true);
  assert.equal(state.writeAllowed, true);
  assert.equal(state.leaderElected, true);
  assert.equal(state.maxConcurrentLeaders, 1);
});

test("quorumtab tillader hverken leder eller usikre writes", () => {
  const state = assessQuorum(base, { down: ["cp-1", "cp-2"] });
  assert.equal(state.hasQuorum, false);
  assert.equal(state.writeAllowed, false);
  assert.equal(state.leaderElected, false);
  assert.equal(state.maxConcurrentLeaders, 0);
  assert.equal(state.unsafeWrites, false);
});

test("frivillig drain og hårdt nedbrud er separate forløb", () => {
  const drain = voluntaryDrain(base, { memberId: "cp-1", now: NOW });
  const crash = hardCrash(base, { memberId: "cp-1", now: NOW });
  assert.equal(drain.mode, "voluntary-drain");
  assert.equal(drain.cordoned, true);
  assert.equal(drain.drained, true);
  assert.equal(drain.inFlightLoss, false);
  assert.equal(crash.mode, "hard-crash");
  assert.equal(crash.drained, false);
  assert.equal(crash.inFlightLoss, true);
  assert.equal(crash.leaderReelection, true);
  assert.equal(drain.quorum.hasQuorum, true);
  assert.equal(crash.quorum.hasQuorum, true);
});

test("en failover-øvelse er en simulering, ikke en måling", () => {
  const result = runFailoverDrill(base, { mode: "hard-crash", memberId: "cp-1", now: NOW });
  assert.equal(result.measured, false);
  assert.equal(result.evidenceKind, "simulation");
  assert.equal(result.requiresLiveMeasurement, true);
  assert.equal(result.withinTarget, true);
});

test("N+1-kapaciteten holder når ét fejldomæne tages ud", () => {
  const loss = capacityAfterLoss(base, 1);
  assert.equal(loss.remainingMembers, 2);
  assert.equal(loss.sufficient, true);
  const doubleLoss = capacityAfterLoss(base, 2);
  assert.equal(doubleLoss.sufficient, false);
});

test("for få fejldomæner, medlemmer eller quorum afvises", () => {
  assert.ok(haClusterProblems({ ...clone(), failureDomains: ["a", "b"] }).some((p) => /tre fejldomæner/.test(p.message)));
  const sameDomain = clone();
  sameDomain.controlPlane.members = sameDomain.controlPlane.members.map((m) => ({ ...m, failureDomain: "fsn1-dc14" }));
  assert.ok(haClusterProblems(sameDomain).some((p) => /tre fejldomæner/.test(p.message)));
  const lowQuorum = clone();
  lowQuorum.controlPlane.datastore.quorum = 1;
  assert.ok(haClusterProblems(lowQuorum).some((p) => /quorum/.test(p.message)));
  const singleLeader = clone();
  singleLeader.controlPlane.members = singleLeader.controlPlane.members.map((m) => ({ ...m, leaderEligible: false }));
  assert.ok(haClusterProblems(singleLeader).some((p) => /leder/.test(p.message)));
});

test("redundant ingress og DNS kræves", () => {
  const oneIngress = clone();
  oneIngress.ingress.replicas = 1;
  assert.ok(haClusterProblems(oneIngress).some((p) => /ingress/.test(p.message)));
  const oneTarget = clone();
  oneTarget.dns.records[0].targets = ["203.0.113.41"];
  assert.ok(haClusterProblems(oneTarget).some((p) => /mindst to mål/.test(p.message)));
  const roundRobin = clone();
  roundRobin.dns.failover = "round-robin";
  assert.ok(haClusterProblems(roundRobin).some((p) => /round-robin/.test(p.message)));
});

test("mTLS, rotation og default-deny er obligatorisk", () => {
  const noMtls = clone();
  noMtls.certificates.mtlsRequired = false;
  assert.ok(haClusterProblems(noMtls).some((p) => /mTLS/.test(p.message)));
  const slowRotation = clone();
  slowRotation.certificates.rotationDays = 180;
  assert.ok(haClusterProblems(slowRotation).some((p) => /certifikatrotation/.test(p.message)));
  const openNetwork = clone();
  openNetwork.network.defaultDeny = false;
  assert.ok(haClusterProblems(openNetwork).some((p) => /default-deny/.test(p.message)));
  const missingPolicy = clone();
  missingPolicy.network.policies = ["default-deny"];
  assert.ok(haClusterProblems(missingPolicy).some((p) => /allow-internal/.test(p.message)));
});

test("utilstrækkelig N+1-kapacitet afvises", () => {
  const tight = clone();
  tight.capacity.baselineCpuMillicores = 20000;
  tight.capacity.perMemberCpuMillicores = 8000;
  assert.ok(haClusterProblems(tight).some((p) => /N\+1/.test(p.message)));
});

test("stateless workloads kræver replikaer, spread, disruption budget og grænser", () => {
  const oneReplica = clone();
  oneReplica.workloads[0].replicas = 1;
  assert.ok(haClusterProblems(oneReplica).some((p) => /mindst to replikaer/.test(p.message)));
  const noSpread = clone();
  delete noSpread.workloads[0].topologySpread;
  assert.ok(haClusterProblems(noSpread).some((p) => /topology spread/.test(p.message)));
  const softSpread = clone();
  softSpread.workloads[0].topologySpread.whenUnsatisfiable = "ScheduleAnyway";
  assert.ok(haClusterProblems(softSpread).some((p) => /samlet/.test(p.message)));
  const noPdb = clone();
  delete noPdb.workloads[0].disruptionBudget;
  assert.ok(haClusterProblems(noPdb).some((p) => /disruption budget/.test(p.message)));
  const blockingPdb = clone();
  blockingPdb.workloads[0].disruptionBudget = { minAvailable: 3, maxUnavailable: 0 };
  assert.ok(haClusterProblems(blockingPdb).some((p) => /blokerer/.test(p.message)));
});

test("stateful workloads kræver en plan og en ekstern recovery-lokation", () => {
  const dbIndex = base.workloads.findIndex((w) => w.stateless === false);
  const noPlan = clone();
  delete noPlan.workloads[dbIndex].statefulPlan;
  assert.ok(haClusterProblems(noPlan).some((p) => /eksplicit plan/.test(p.message)));
  const insideDomain = clone();
  insideDomain.workloads[dbIndex].statefulPlan.recoveryLocation = "fsn1-dc14";
  assert.ok(haClusterProblems(insideDomain).some((p) => /recovery-lokation/.test(p.message)));
});

test("HA-planen er kompatibel med de HA-egnede serviceklasser", () => {
  assert.deepEqual(haServiceClassProblems(base, loadServiceClasses()), []);
});
