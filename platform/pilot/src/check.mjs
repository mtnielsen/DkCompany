/**
 * DKC-033 — fokuseret, deterministisk pilotkontrol.
 *
 * Bygger readiness-rapporten af de faktiske kørsler og den faktiske evidens:
 *   - de 18 pilotscenarier (tre profiler × seks arbejdsgange) køres mod den
 *     valgte installationsprofil,
 *   - abuse-prober beviser at godkendelser, kundeisolering og ubetroet indhold
 *     ikke kan omgås,
 *   - en afgrænset belastningstest kører et fast antal iterationer, og
 *   - readiness-aggregatoren læser sikkerhedsvurderingen, recovery-øvelsen,
 *     omkostningsrapporten, observationsperioden og kundeaccepten.
 *
 * `measured: false`: alt er efterprøvet deterministisk. En 30-dages observation
 * og en kundcaccept er særskilt NOT RUN.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { loadProfiles as loadCatalogProfiles } from "../../distribution/src/catalog.mjs";
import { CHECKS } from "../../tools/baseline/registry.mjs";
import { loadTestMatrix } from "../../release/src/load.mjs";
import {
  loadAll,
  pilotDigest,
  pilotProfileProblems,
  pilotScenarioProblems,
  readinessPolicyProblems,
  observationProblems,
  customerAcceptanceProblems,
  readinessReportProblems,
  REPORT_GENERATED_AT,
  REPORT_PATH,
  REPORT_DOC_PATH,
} from "./model.mjs";
import { runPilotScenarios, runAbuseProbes, runBoundedLoad } from "./scenarios.mjs";
import { collectEvidence, evaluateGates, buildProfileResults, decideReadiness } from "./readiness.mjs";
import { renderPilotReport } from "./report.mjs";

export const TARGET_COMMIT = "83ad91a963d8055f77c29fb4361455689df95acb";

function deploymentProfileNames(root) {
  return loadCatalogProfiles(join(root, "catalog", "profiles")).map((p) => p.data?.metadata?.name).filter(Boolean);
}

function acceptanceSummary(observation, policy) {
  return {
    status: observation.status,
    requiredDays: policy.observation?.requiredDays ?? observation.requiredDays,
    observedDays: observation.observedDays,
    startedAt: observation.startedAt ?? null,
    endedAt: observation.endedAt ?? null,
    note: observation.note ?? "observationen er en faktisk kalendertidsbegivenhed",
  };
}

function customerAcceptanceSummary(register) {
  const accepted = (register.acceptances ?? [])[0] ?? null;
  if (!accepted) {
    return { status: "pending", accepted: false, acceptedBy: null, acceptedAt: null, limitations: register.knownLimitations ?? [], note: "Ingen navngivet kunde har endnu accepteret de kendte begrænsninger." };
  }
  return {
    status: "accepted",
    accepted: true,
    acceptedBy: accepted.acceptedBy?.name ?? accepted.acceptedBy?.subject ?? null,
    acceptedAt: accepted.acceptedAt ?? null,
    limitations: accepted.limitations ?? [],
    note: accepted.note ?? null,
  };
}

export async function buildPilotReport(root = repoRoot) {
  const all = loadAll(root);
  const profiles = all.profiles.profiles ?? [];
  const requirementIds = (loadTestMatrix().requirements ?? []).map((r) => r.id);
  const problems = [];

  const deploymentProfiles = deploymentProfileNames(root);
  for (const e of pilotProfileProblems(all.profiles, { deploymentProfiles })) problems.push(`profiles${e.path}: ${e.message}`);
  for (const e of pilotScenarioProblems(all.scenarios, { profiles })) problems.push(`scenarios${e.path}: ${e.message}`);
  for (const e of readinessPolicyProblems(all.policy, { registry: CHECKS, requirementIds })) problems.push(`policy${e.path}: ${e.message}`);
  for (const e of observationProblems(all.observation, { requiredDays: all.policy.observation?.requiredDays ?? 30 })) problems.push(`observation${e.path}: ${e.message}`);
  for (const e of customerAcceptanceProblems(all.customerAcceptance, { acceptedByRoles: all.policy.customerAcceptance?.acceptedByRoles ?? [], maxAgeDays: all.policy.customerAcceptance?.maxAgeDays ?? 30 })) problems.push(`customer-acceptance${e.path}: ${e.message}`);

  const scenarioOutcomes = await runPilotScenarios({ profiles: all.profiles, scenarios: all.scenarios });
  const abuse = await runAbuseProbes();
  const load = await runBoundedLoad();
  const evidence = collectEvidence(root);
  const gates = evaluateGates({ policy: all.policy, profiles: all.profiles, evidence, scenarioOutcomes });
  const profileResults = buildProfileResults({ profiles: all.profiles, scenarios: all.scenarios, scenarioOutcomes, evidence });
  const readiness = decideReadiness(gates);

  for (const outcome of scenarioOutcomes) {
    if (outcome.status !== "passed") problems.push(`scenarie '${outcome.scenarioId}': ${(outcome.problems ?? []).slice(0, 3).join("; ")}`);
  }
  for (const violation of abuse.violations) problems.push(`abuse-probe: ${violation}`);
  if (load.failures > 0) problems.push(`belastningstesten havde ${load.failures} fejl`);
  if (load.bypasses > 0) problems.push(`belastningstesten fandt ${load.bypasses} omgåelser`);

  const artifactDigest = pilotDigest({ profiles: all.profiles, scenarios: all.scenarios, policy: all.policy, observation: all.observation, customerAcceptance: all.customerAcceptance });

  const report = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "PilotReadinessReport",
    metadata: {
      name: "platform-pilot-readiness-report",
      version: "1.0.0",
      description: "Deterministisk readiness-rapport for pilotforløbet: kørebare scenarier pr. virksomhedsprofil, abuse- og belastningsprober samt gate-vurderinger fra faktisk evidens.",
      accountableHuman: all.profiles.metadata.accountableHuman,
      labels: all.profiles.metadata.labels ?? {},
    },
    generatedAt: REPORT_GENERATED_AT,
    measured: false,
    targetCommit: TARGET_COMMIT,
    artifactDigest,
    readiness,
    profiles: profileResults,
    gates,
    abuse,
    load,
    observation: acceptanceSummary(all.observation, all.policy),
    customerAcceptance: customerAcceptanceSummary(all.customerAcceptance),
    problems,
  };

  const ajv = buildAjv().ajv;
  const schemaResult = validate(ajv, SCHEMA_IDS.pilotReadiness, report);
  if (!schemaResult.ok) for (const e of schemaResult.errors.slice(0, 10)) problems.push(`rapport${e.path}: ${e.message}`);
  for (const e of readinessReportProblems(report)) problems.push(`rapport${e.path}: ${e.message}`);

  return { report, problems, scenarioOutcomes, abuse, load, gates, evidence };
}

export async function runPilotCheck(root = repoRoot) {
  const { report, problems } = await buildPilotReport(root);
  const rendered = renderPilotReport(report);
  for (const [path, content] of rendered) {
    const full = join(root, path);
    if (!existsSync(full)) problems.push(`${path} mangler; kør 'make pilot-render'`);
    else if (readFileSync(full, "utf8") !== content) problems.push(`${path} er ude af trit med den kanoniske kilde; kør 'make pilot-render'`);
  }
  return { ok: problems.length === 0, problems, report };
}

export { REPORT_PATH, REPORT_DOC_PATH };

async function main() {
  const result = await runPilotCheck(repoRoot);
  if (!result.ok) {
    console.error("✘ Pilotkontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const passed = result.report.profiles.filter((p) => p.complete).length;
  const activeGates = result.report.gates.filter((g) => g.applicable).length;
  const pending = result.report.gates.filter((g) => g.applicable && g.status !== "passed").map((g) => g.id);
  console.log(`✔ ${passed}/${result.report.profiles.length} virksomhedsprofiler gennemførte alle seks arbejdsgange`);
  console.log(`✔ ${activeGates} aktive readiness-gates vurderet; udestående: ${pending.join(", ") || "ingen"}`);
  console.log(`✔ abuse-prober: ${result.report.abuse.violations.length} omgåelser; belastning: ${result.report.load.failures} fejl, ${result.report.load.bypasses} omgåelser`);
  console.log(`✔ readiness: ${result.report.readiness}`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
