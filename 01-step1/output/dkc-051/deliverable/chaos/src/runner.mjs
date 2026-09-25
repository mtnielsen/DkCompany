/**
 * DKC-051 — den deterministiske fejl- og katastrofekører.
 *
 * Kører hvert scenarie i fejlmatrixen gennem sin probe, sammenligner det målte
 * dataudfald og RPO/RTO med det erklærede, opgør invarianterne og udleder en
 * release-gate med en afvigelsesrapport. Resultatet bærer `measured: false`:
 * det er en isoleret, gentagelig model, ikke en målt hændelse.
 */
import { loadFailureMatrix } from "./matrix.mjs";
import { PROBES } from "./probes.mjs";

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export async function runChaos(root, { matrix = null } = {}) {
  const plan = matrix ?? loadFailureMatrix(root);
  const scenarios = [];

  for (const scenario of plan.scenarios) {
    const probe = PROBES[scenario.probe];
    if (!probe) {
      scenarios.push({
        ...scenario,
        status: "fail",
        checks: { probeExists: false },
        reasons: [`ukendt probe '${scenario.probe}'`],
        splitBrain: false,
        lostAcknowledgedWrites: 0,
        measuredRpoMinutes: 0,
        measuredRtoMinutes: 0,
        bypassesDenied: 0,
        bypassesLogged: 0,
        budgetBounded: false,
        escalatedToHuman: false,
        repeatableFromCleanInstall: false,
      });
      continue;
    }

    let result;
    try {
      result = await probe(root);
    } catch (error) {
      result = {
        ok: false,
        checks: { probeError: false },
        splitBrain: false,
        lostAcknowledgedWrites: 0,
        measuredRpoMinutes: 0,
        measuredRtoMinutes: 0,
        bypassesDenied: 0,
        bypassesLogged: 0,
        budgetBounded: false,
        escalatedToHuman: false,
        repeatableFromCleanInstall: false,
        detail: { error: error?.message ?? String(error) },
      };
    }

    const withinRpo = result.measuredRpoMinutes <= scenario.rpoMinutes;
    const withinRto = result.measuredRtoMinutes <= scenario.rtoMinutes;
    const invariantsOk = result.splitBrain === false && result.lostAcknowledgedWrites === 0;
    const reasons = [];
    if (!result.ok) reasons.push(...Object.entries(result.checks).filter(([, ok]) => ok !== true).map(([name]) => `check fejlede: ${name}`));
    if (!withinRpo) reasons.push(`målt RPO ${result.measuredRpoMinutes} min > erklæret ${scenario.rpoMinutes} min`);
    if (!withinRto) reasons.push(`målt RTO ${result.measuredRtoMinutes} min > erklæret ${scenario.rtoMinutes} min`);
    if (result.splitBrain) reasons.push("split-brain observeret");
    if (result.lostAcknowledgedWrites > 0) reasons.push(`${result.lostAcknowledgedWrites} kvitteret write(s) tabt`);

    scenarios.push({
      ...scenario,
      status: reasons.length === 0 ? "pass" : "fail",
      checks: result.checks,
      detail: result.detail ?? null,
      reasons,
      splitBrain: result.splitBrain,
      lostAcknowledgedWrites: result.lostAcknowledgedWrites,
      measuredRpoMinutes: round(result.measuredRpoMinutes),
      measuredRtoMinutes: round(result.measuredRtoMinutes),
      bypassesDenied: result.bypassesDenied,
      bypassesLogged: result.bypassesLogged,
      budgetBounded: result.budgetBounded,
      escalatedToHuman: result.escalatedToHuman,
      repeatableFromCleanInstall: result.repeatableFromCleanInstall,
    });
  }

  const byId = (id) => scenarios.find((s) => s.id === id);
  const immutable = byId("immutable-bypass");
  const healing = byId("healing-storm");

  const invariants = {
    noSplitBrain: scenarios.every((s) => s.splitBrain === false),
    noLostAcknowledgedWrites: scenarios.every((s) => s.lostAcknowledgedWrites === 0),
    immutableBypassDeniedAndLogged: Boolean(immutable && immutable.bypassesDenied > 0 && immutable.bypassesLogged >= immutable.bypassesDenied && immutable.status === "pass"),
    healingStormBounded: Boolean(healing && healing.budgetBounded === true && healing.escalatedToHuman === true),
    repeatableFromCleanInstall: scenarios.every((s) => s.repeatableFromCleanInstall === true),
  };

  const deviations = scenarios
    .filter((s) => s.status !== "pass")
    .map((s) => ({ id: s.id, failureScope: s.failureScope, reasons: s.reasons }));

  const invariantReasons = Object.entries(invariants)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => `invariant brudt: ${name}`);

  const gate = {
    status: deviations.length === 0 && invariantReasons.length === 0 ? "pass" : "block",
    reasons: [...invariantReasons, ...deviations.flatMap((d) => d.reasons.map((r) => `${d.id}: ${r}`))],
  };

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ChaosReport",
    generatedFrom: "chaos/failure-matrix.json",
    measured: false,
    requiresLiveStaging: true,
    principle: plan.principle,
    invariants,
    scenarios,
    deviations,
    gate,
  };
}
