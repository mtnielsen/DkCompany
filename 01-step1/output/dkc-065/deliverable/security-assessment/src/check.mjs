/**
 * DKC-065 — fokuseret, deterministisk kontrol af sikkerhedsvurderingen.
 *
 * Kontrollerer offline at:
 *   - engagementet er et forberedt, ikke-autoriserende dokument for levende test,
 *   - den committede vurdering matcher den deterministiske genberegning,
 *   - alle ni versionerede dækningskategorier er bundet til konkrete sonder,
 *   - produktionsgaten **fejler lukket**: uden en uafhængig vurdering og en
 *     navngivet menneskelig releasebeslutning forbliver den blokeret og
 *     udestående,
 *   - rapporten er i trit med den kanoniske kilde.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv } from "../../conformance/src/schemas.mjs";
import { validateRulesOfEngagement, validateSecurityAssessment, evaluateAssessmentGate, gateResultProblems } from "../../conformance/src/pentest.mjs";
import { CHECKS } from "../../tools/baseline/registry.mjs";
import { buildAssessment } from "./build.mjs";
import { ASSESSMENT_PATH, REPORT_DOC_PATH, REPORT_GENERATED_AT, REPORT_PATH, TARGET_COMMIT, loadRulesOfEngagement } from "./model.mjs";
import { buildReport, renderReportMarkdown } from "./report.mjs";

export const repoRoot = join(import.meta.dirname, "..", "..");

export async function runSecurityAssessmentCheck(root = repoRoot) {
  const problems = [];
  const now = Date.parse(REPORT_GENERATED_AT);
  const { assessment: expected } = await buildAssessment({ root, now });
  const path = join(root, ASSESSMENT_PATH);
  let committed = null;
  if (!existsSync(path)) {
    problems.push(`${ASSESSMENT_PATH} mangler. Kør 'make security-assessment-write'.`);
  } else {
    committed = JSON.parse(readFileSync(path, "utf8"));
    if (JSON.stringify(committed) !== JSON.stringify(expected)) {
      problems.push(`${ASSESSMENT_PATH} er ude af trit med den kanoniske kilde. Kør 'make security-assessment-write'.`);
    }
  }
  const data = committed ?? expected;
  const roe = loadRulesOfEngagement(root);
  const ajv = buildAjv().ajv;
  const checkIds = new Set(CHECKS.map((c) => c.id));

  const rulesResult = validateRulesOfEngagement(roe, ajv, { now });
  if (!rulesResult.ok) for (const e of rulesResult.errors.slice(0, 10)) problems.push(`${ASSESSMENT_PATH.replace("assessment.json", "rules-of-engagement.json")}${e.path}: ${e.message}`);

  const assessmentResult = validateSecurityAssessment(data, ajv, { now, roe, expectedCommit: TARGET_COMMIT, expectedArtifactDigest: data?.artifactBinding?.artifactDigest, checkIds });
  if (!assessmentResult.ok) for (const e of assessmentResult.errors.slice(0, 10)) problems.push(`${ASSESSMENT_PATH}${e.path}: ${e.message}`);

  const gate = evaluateAssessmentGate({ assessment: data, roe, now, expectedCommit: TARGET_COMMIT, expectedArtifactDigest: data?.artifactBinding?.artifactDigest });
  for (const p of gateResultProblems(gate)) problems.push(`gate${p.path}: ${p.message}`);
  if (gate.decision !== "blocked") problems.push("produktionsgaten skal være blokeret så længe den uafhængige vurdering og den menneskelige beslutning mangler");
  if (!gate.outstanding) problems.push("produktionsgaten skal markere vurderingen som udestående");

  const report = buildReport(data, gate);
  const expectedJson = JSON.stringify(report, null, 2) + "\n";
  const expectedMd = renderReportMarkdown(report);
  for (const [rel, content] of [[REPORT_PATH, expectedJson], [REPORT_DOC_PATH, expectedMd]]) {
    const full = join(root, rel);
    if (!existsSync(full)) problems.push(`${rel} mangler. Kør 'make security-assessment-write'.`);
    else if (readFileSync(full, "utf8") !== content) problems.push(`${rel} er ude af trit med den kanoniske kilde. Kør 'make security-assessment-write'.`);
  }

  return { ok: problems.length === 0, problems, assessment: data, gate, report };
}

async function main() {
  const result = await runSecurityAssessmentCheck(repoRoot);
  if (!result.ok) {
    console.error("✘ Sikkerhedsvurderingskontrol fejlede:\n");
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\u2714 Sikkerhedsvurdering bestået: ${result.assessment.coverage.length} dækningskategorier, ${result.report.harness.passed}/${result.report.harness.total} sonder bestået`);
  console.log(`\u2714 Produktionsgate: ${result.gate.decision} (udestående=${result.gate.outstanding}) — ${result.gate.blockers.length} blokker(e)`);
  console.log("\u2714 Rapporten er i trit med den kanoniske kilde");
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
