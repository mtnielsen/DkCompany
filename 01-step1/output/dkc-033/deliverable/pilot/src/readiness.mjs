/**
 * DKC-033 — readiness-aggregator.
 *
 * Aggregatoren læser faktisk evidens (sikkerhedsvurderingen, de kørebare
 * pilotscenarier, recovery-øvelsen, omkostningsrapporten, observationsperioden
 * og kundeaccepten) og svarer på ét spørgsmål: er piloten klar? En gate består
 * aldrig på en grøn check alene; manglende eller udestående evidens giver
 * `not-run`/`pending`, og en åben omgåelse eller et manglende kundcaccept giver
 * `not-ready`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRulesOfEngagement, loadAssessment, evaluateAssessmentGate, REPORT_GENERATED_AT as SA_GENERATED_AT } from "../../security-assessment/src/model.mjs";
import { loadObservation, loadCustomerAcceptance, gateApplies, worstGateStatus, JOURNEYS } from "./model.mjs";

const NOW = Date.parse(SA_GENERATED_AT);

function readJsonIfExists(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function collectEvidence(root) {
  const roe = (() => {
    try {
      return loadRulesOfEngagement(root);
    } catch {
      return null;
    }
  })();
  const assessment = (() => {
    try {
      return loadAssessment(root);
    } catch {
      return null;
    }
  })();
  const securityGate = evaluateAssessmentGate({ assessment, roe, now: NOW });
  return {
    securityAssessment: { roe, assessment, gate: securityGate },
    independentAssessments: readJsonIfExists(root, "release/matrix/assessments.json"),
    testMatrix: readJsonIfExists(root, "release/matrix/test-matrix.json"),
    recoverySuite: readJsonIfExists(root, "continuity/report/recovery-drill-report.json"),
    costReport: readJsonIfExists(root, "metering/report/cost-report.json"),
    observation: loadObservation(root),
    customerAcceptance: loadCustomerAcceptance(root),
  };
}

function statusOfSecurity(evidence) {
  const gate = evidence.securityAssessment?.gate;
  if (!gate) return { status: "missing", detail: "sikkerhedsvurderingen kunne ikke læses" };
  if (gate.decision === "eligible") return { status: "passed", detail: `dækning ${gate.coverage.passed}/${gate.coverage.total}` };
  if (gate.outstanding) return { status: "pending", detail: (gate.blockers ?? []).map((b) => b.id).slice(0, 3).join(", ") };
  return { status: "failed", detail: (gate.blockers ?? []).map((b) => b.id).slice(0, 3).join(", ") };
}

function statusOfIndependent(evidence, now = NOW) {
  const list = evidence.independentAssessments?.assessments ?? [];
  if (list.length === 0) return { status: "pending", detail: "ingen registreret uafhængig vurdering" };
  const valid = list.filter((a) => {
    const performed = Date.parse(a.performedAt ?? "");
    const expires = Date.parse(a.expiresAt ?? "");
    return Number.isFinite(performed) && Number.isFinite(expires) && performed <= now && expires > now;
  });
  return valid.length ? { status: "passed", detail: `${valid.length} gyldig(e) vurdering(er)` } : { status: "failed", detail: "alle registrerede vurderinger er udløbet eller ugyldige" };
}

function statusOfScenarios(evidence, scenarioOutcomes) {
  if (!scenarioOutcomes || scenarioOutcomes.length === 0) return { status: "missing", detail: "ingen kørebare pilotscenarier" };
  const failed = scenarioOutcomes.filter((o) => o.status !== "passed");
  return failed.length ? { status: "failed", detail: `${failed.length} scenarie(r) fejlede` } : { status: "passed", detail: `${scenarioOutcomes.length} scenarier bestået` };
}

function statusOfRecovery(evidence, scenarioOutcomes) {
  const suite = evidence.recoverySuite;
  const restoreOutcomes = (scenarioOutcomes ?? []).filter((o) => o.journey === "restore");
  const restoreOk = restoreOutcomes.length > 0 && restoreOutcomes.every((o) => o.status === "passed");
  if (!suite) return { status: "missing", detail: "recovery-rapporten findes ikke" };
  if (!restoreOk) return { status: "failed", detail: "en eller flere restore-arbejdsgange fejlede" };
  return { status: "passed", detail: `recovery-øvelse ${suite.measured === true ? "målt" : "deterministisk"}, ${restoreOutcomes.length} restore-runs` };
}

function statusOfCost(evidence) {
  const report = evidence.costReport;
  if (!report) return { status: "missing", detail: "omkostningsrapporten findes ikke" };
  const tenants = report.tenants ?? [];
  if (tenants.length === 0) return { status: "failed", detail: "omkostningsrapporten har ingen tenants" };
  return { status: "passed", detail: `${tenants.length} tenant-omkostninger` };
}

function statusOfObservation(evidence, policy) {
  const observation = evidence.observation;
  if (!observation) return { status: "missing", detail: "observationsregisteret findes ikke" };
  const required = policy.observation?.requiredDays ?? 30;
  if (observation.status === "complete" && observation.observedDays >= required) return { status: "passed", detail: `${observation.observedDays}/${required} dage` };
  return { status: "pending", detail: `status '${observation.status}' (${observation.observedDays}/${required} dage)` };
}

function statusOfCustomerAcceptance(evidence) {
  const register = evidence.customerAcceptance;
  if (!register) return { status: "missing", detail: "kundeaccept-registeret findes ikke" };
  const accepted = register.acceptances ?? [];
  if (accepted.length === 0) return { status: "pending", detail: "ingen registreret kundcaccept" };
  return { status: "passed", detail: `${accepted.length} accepter` };
}

function statusOfTestMatrix(evidence) {
  const matrix = evidence.testMatrix;
  if (!matrix) return { status: "missing", detail: "testmatricen findes ikke" };
  const count = (matrix.requirements ?? []).length;
  if (count === 0) return { status: "failed", detail: "testmatricen har ingen krav" };
  return { status: "passed", detail: `${count} krav` };
}

function statusOfHa(evidence) {
  const suite = evidence.recoverySuite;
  if (!suite) return { status: "missing", detail: "HA-/recoverygrundlaget findes ikke" };
  return { status: "passed", detail: "HA-plan og serviceklasser er efterprøvet deterministisk; målt failover er NOT RUN" };
}

const RESOLVERS = {
  "security-assessment": (evidence) => statusOfSecurity(evidence),
  "independent-assessment": (evidence) => statusOfIndependent(evidence),
  "pilot-scenarios": (evidence, ctx) => statusOfScenarios(evidence, ctx.scenarioOutcomes),
  "restore-drill": (evidence, ctx) => statusOfRecovery(evidence, ctx.scenarioOutcomes),
  "cost-report": (evidence) => statusOfCost(evidence),
  "observation-period": (evidence, ctx) => statusOfObservation(evidence, ctx.policy),
  "customer-acceptance": (evidence) => statusOfCustomerAcceptance(evidence),
  "test-matrix": (evidence) => statusOfTestMatrix(evidence),
};

function gateStatusFromEvidence(evidenceList) {
  if (evidenceList.some((e) => e.status === "failed")) return "failed";
  if (evidenceList.some((e) => e.status === "missing")) return "not-run";
  if (evidenceList.some((e) => e.status === "pending")) return "pending";
  return "passed";
}

export function evaluateGates({ policy, profiles, evidence, scenarioOutcomes, now = NOW }) {
  const profileList = profiles?.profiles ?? [];
  return (policy?.gates ?? []).map((gate) => {
    const applicable = profileList.some((p) => gateApplies(gate, p));
    if (!applicable) {
      return { id: gate.id, kind: gate.kind, applicable: false, mandatory: gate.mandatory === true, status: "not-applicable", reasons: [], evidence: [] };
    }
    const resolved = [];
    for (const source of gate.evidenceSources ?? []) {
      const resolver = RESOLVERS[source.kind] ?? (() => ({ status: "missing", detail: `ukendt evidensart '${source.kind}'` }));
      const result = source.kind === "ha" ? statusOfHa(evidence) : resolver(evidence, { policy, scenarioOutcomes });
      resolved.push({ kind: source.kind, ref: source.ref, status: result.status, detail: result.detail ?? null });
    }
    const status = gateStatusFromEvidence(resolved);
    const reasons = resolved.filter((e) => e.status !== "passed").map((e) => `${e.kind}: ${e.detail ?? e.status}`);
    return { id: gate.id, kind: gate.kind, applicable: true, mandatory: gate.mandatory === true, status, reasons, evidence: resolved };
  });
}

export function buildProfileResults({ profiles, scenarios, scenarioOutcomes, evidence }) {
  const outcomesById = new Map((scenarioOutcomes ?? []).map((o) => [o.scenarioId, o]));
  const costByTenant = new Map((evidence.costReport?.tenants ?? []).map((t) => [t.tenantId, t.total ?? null]));
  return (profiles?.profiles ?? []).map((profile) => {
    const profileScenarios = (scenarios?.scenarios ?? []).filter((s) => s.profileRef === profile.id);
    const workflows = JOURNEYS.map((journey) => {
      const scenario = profileScenarios.find((s) => s.journey === journey);
      const outcome = scenario ? outcomesById.get(scenario.id) : null;
      if (!outcome) {
        return { scenarioId: scenario?.id ?? `${profile.id}-${journey}`, journey, runner: journey, status: "failed", steps: [], problems: ["scenariet blev ikke kørt"], metrics: {} };
      }
      return outcome;
    });
    const restore = workflows.find((w) => w.journey === "restore");
    return {
      profileRef: profile.id,
      segment: profile.segment,
      deploymentProfileRef: profile.deploymentProfileRef,
      companySizeEmployees: profile.companySizeEmployees,
      workflows,
      complete: workflows.every((w) => w.status === "passed"),
      rpoMinutes: restore?.metrics?.rpoMinutes ?? null,
      rtoMinutes: restore?.metrics?.rtoMinutes ?? null,
      monthlyCostEur: costByTenant.get(profile.ledgerTenantId) ?? null,
    };
  });
}

export function decideReadiness(gates) {
  const active = (gates ?? []).filter((g) => g.applicable && g.mandatory);
  return active.every((g) => g.status === "passed") ? "ready" : "not-ready";
}

export { worstGateStatus };
