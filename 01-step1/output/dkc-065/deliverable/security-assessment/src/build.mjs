/**
 * DKC-065 — byg den kanoniske sikkerhedsvurdering deterministisk.
 *
 * Vurderingen kombinerer det forberedte engagement, den isolerede
 * regressionsharness og den deterministiske artefaktbinding. Den indeholder
 * **ingen** uafhængig assessor og **ingen** menneskelig releasebeslutning, så
 * produktionsgaten forbliver udestående. Det er den ærlige tilstand: opgaven
 * leverer forberedelsen, ikke den eksterne vurdering.
 */
import { loadRulesOfEngagement, computeArtifactBinding, ASSESSMENT_VERSION, COVERAGE_IDS, REPORT_GENERATED_AT, TARGET_COMMIT, PRODUCER } from "./model.mjs";
import { runSecurityHarness } from "./harness.mjs";

export async function buildAssessment({ root, now = Date.parse(REPORT_GENERATED_AT) } = {}) {
  const roe = loadRulesOfEngagement(root);
  const artifactBinding = computeArtifactBinding(root, { targetCommit: TARGET_COMMIT });
  const target = (roe.targets ?? []).find((t) => t.id === "local-loopback") ?? (roe.targets ?? [])[0];
  const run = await runSecurityHarness({ root, roe, target, now, runId: "RUN-LOCAL-REGRESSION", targetId: target?.id ?? "local-loopback" });
  const coverage = COVERAGE_IDS.map((id) => {
    const probes = run.probes.filter((p) => p.category === id);
    const status = probes.length === 0 ? "not-run" : probes.every((p) => p.result === "passed") ? "passed" : "failed";
    return {
      id,
      version: "1.0.0",
      required: true,
      status,
      evidenceRefs: [...new Set(probes.map((p) => p.evidenceRef))],
      probeIds: probes.map((p) => p.id),
      notes: probes.length === 0 ? "Ingen lokal, ikke-destruktiv sonde findes for denne kategori; kræver den uafhængige vurdering." : "Dækket af den isolerede lokale regressionsharness.",
    };
  });

  const assessment = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "SecurityAssessment",
    metadata: {
      name: "platform-security-assessment",
      version: "1.0.0",
      description: "Versioneret sikkerhedsvurdering: forberedt engagement, isoleret lokal regressionsharness med ni dækningskategorier, fund/retest-import og artefaktbinding. Den uafhængige vurdering og den menneskelige releasebeslutning er udestående.",
      accountableHuman: roe.metadata.accountableHuman,
    },
    assessmentVersion: ASSESSMENT_VERSION,
    generatedAt: new Date(now).toISOString(),
    measured: false,
    rulesOfEngagementRef: "security-assessment/rules-of-engagement.json",
    artifactBinding,
    coverage,
    harnessRuns: [run],
    findings: [],
    retests: [],
    impactReview: null,
    independentAssessment: null,
    releaseDecision: null,
    status: "outstanding",
  };
  return { assessment, run, roe, producer: PRODUCER };
}
