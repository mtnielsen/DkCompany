/**
 * DKC-062 — fokuseret, deterministisk kontrol af installations- og
 * releaseacceptance.
 *
 * Kontrollerer offline at:
 *   - alle brugerrejser (install, konfiguration, tilføj/fjern, opgradering,
 *     provider-skift, eskalation, recovery og exit) består på de understøttede
 *     profiler og platforme,
 *   - den profilbevidste acceptgate aktiverer de rigtige gates pr. mål og kun
 *     lader en aktiv gate bestå med både testbevis og registreret ejeraccept,
 *   - ingen agent kan udføre to roller via rotation, alias eller subagent, og
 *   - acceptrapporten er i trit med den kanoniske kilde.
 *
 * `measured: false`: alt er efterprøvet deterministisk. En rigtig
 * VPS/lokal/HA-installation og den menneskelige ejeraccept er særskilt NOT RUN.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadDesiredState, loadHostScope } from "../../configuration/src/model.mjs";
import { loadProfiles } from "./catalog.mjs";
import { loadAll, acceptanceDigest, acceptanceResultProblems, REPORT_GENERATED_AT } from "./acceptance-model.mjs";
import { runAcceptanceScenarios, probeRoleSeparation } from "./acceptance-run.mjs";
import { aggregateAcceptance, deriveTargets, deterministicCheckEvidence } from "./acceptance-gate.mjs";
import { renderAcceptanceReport } from "./acceptance-report.mjs";
import { CHECKS, COMPONENTS } from "../../tools/baseline/registry.mjs";
import { loadTestMatrix } from "../../release/src/load.mjs";

export const TARGET_COMMIT = "83ad91a963d8055f77c29fb4361455689df95acb";

function loadKeyring(root) {
  return JSON.parse(readFileSync(join(root, "configuration", "dev-keyring.json"), "utf8"));
}

export async function buildAcceptanceReport(root = repoRoot) {
  const all = loadAll(root);
  const keyring = loadKeyring(root);
  const config = loadDesiredState(root);
  const hostScope = loadHostScope(root);
  const profiles = loadProfiles(join(root, "catalog", "profiles")).map((p) => p.data);
  const outcomes = await runAcceptanceScenarios(root, { scenarioSet: all.scenarios, keyring, config, hostScopeBase: hostScope });
  const roleViolations = probeRoleSeparation();
  const targets = deriveTargets({ scenarioSet: all.scenarios, profiles });
  const artifactDigest = acceptanceDigest({ scenarios: all.scenarios, policy: all.policy, raci: all.raci, ownerAcceptance: all.ownerAcceptance });
  const matrix = loadTestMatrix();
  const checkEvidence = deterministicCheckEvidence({ registry: CHECKS, targetCommit: TARGET_COMMIT, artifactDigest, generatedAt: REPORT_GENERATED_AT });

  const problems = [];
  const results = targets.map((target) =>
    aggregateAcceptance({
      target,
      policy: all.policy,
      registry: CHECKS,
      components: COMPONENTS,
      matrix,
      scenarioSet: all.scenarios,
      scenarioOutcomes: outcomes,
      checkEvidence,
      ownerAcceptance: all.ownerAcceptance,
      roleViolations,
      now: REPORT_GENERATED_AT,
      targetCommit: TARGET_COMMIT,
      artifactDigest,
      producer: { type: "implementer", name: "acceptance-suite", subject: "process|acceptance" },
      environment: { measured: false },
    })
  );

  for (const result of results) {
    for (const problem of acceptanceResultProblems(result)) problems.push(`target '${result.target.id}'${problem.path}: ${problem.message}`);
    for (const gate of result.gates) {
      if (!gate.applicable) continue;
      if (gate.evidenceStatus !== "passed") problems.push(`target '${result.target.id}', gate '${gate.id}': testbeviset er '${gate.evidenceStatus}' (${gate.reasons[0] ?? ""})`);
    }
  }
  if (roleViolations.length) problems.push(`rolle-adskillelsen blev brudt: ${roleViolations.join(", ")}`);
  for (const outcome of outcomes) {
    if (outcome.status !== "passed") problems.push(`scenariet '${outcome.id}' fejlede: ${outcome.problems.slice(0, 3).join("; ")}`);
  }

  const report = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AcceptanceReport",
    metadata: {
      name: "platform-acceptance-report",
      version: "1.0.0",
      description: "Deterministisk rapport for installations- og releaseacceptance: kørebare brugerrejser, profilbevidste gates med fælles og særskilte krav, RACI og registreret ejeraccept.",
      accountableHuman: all.scenarios.metadata.accountableHuman,
      labels: all.scenarios.metadata.labels ?? {},
    },
    generatedAt: REPORT_GENERATED_AT,
    measured: false,
    targetCommit: TARGET_COMMIT,
    artifactDigest,
    scenarioCount: outcomes.length,
    roleViolations,
    outcomes,
    targets: results,
  };
  return { report, problems };
}

export async function runAcceptanceCheck(root = repoRoot) {
  const { report, problems } = await buildAcceptanceReport(root);
  const rendered = renderAcceptanceReport(report);
  for (const [path, content] of rendered) {
    const full = join(root, path);
    if (!existsSync(full)) problems.push(`${path} mangler; kør 'make acceptance-render'`);
    else if (readFileSync(full, "utf8") !== content) problems.push(`${path} er ude af trit med den kanoniske kilde; kør 'make acceptance-render'`);
  }
  return { ok: problems.length === 0, problems, report };
}

async function main() {
  const result = await runAcceptanceCheck(repoRoot);
  if (!result.ok) {
    console.error("✘ Acceptkontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const passed = result.report.outcomes.filter((o) => o.status === "passed").length;
  const activeGates = result.report.targets.flatMap((r) => r.gates.filter((g) => g.applicable)).length;
  const pending = result.report.targets.flatMap((r) => r.ownerAcceptance.pendingGates);
  console.log(`✔ ${passed}/${result.report.scenarioCount} brugerrejser bestået på ${result.report.targets.length} acceptmål`);
  console.log(`✔ ${activeGates} aktive gates vurderet; ${pending.length} afventer registreret menneskelig ejeraccept`);
  console.log("✔ Acceptrapporten er i trit med den kanoniske kilde");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
