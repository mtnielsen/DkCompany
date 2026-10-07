/**
 * DKC-022 — evidens- og risikoregister samt samling af evidenspakken.
 *
 * Den kanoniske kilde er `compliance/assurance-register.json`. Den valideres
 * mod kontrakten og beslutningssemantikken i `conformance/src/assurance.mjs`,
 * krydsrefereres mod dataregisteret og kontrolmappingen, og
 * `docs/compliance/assurance.md` genereres herfra.
 *
 * `assembleEvidencePackage` samler de faktiske evidensposter pr. krav. Den
 * genbruger `evidence/src/evidence-mode.mjs`, så forældet, artefakt-mismatchet
 * og manuelt ændret evidens afvises med en stabil årsag. Pakken skelner
 * eksplicit mellem automatiseret evidens, manglende vurderinger og
 * menneskelige beslutninger, og hverken en eksport eller et badge erklærer
 * platformen compliant.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { assuranceRegisterProblems, pilotBlockers } from "../../conformance/src/assurance.mjs";
import { assessRecord, NON_PRODUCTION_MODES, loadEvidenceRecords } from "../../conformance/src/evidence-mode.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
export const registerPath = join(repoRoot, "compliance", "assurance-register.json");
export const outputPath = join(repoRoot, "docs", "compliance", "assurance.md");
export const packagePath = join(repoRoot, "evidence", "generated", "assurance-package.json");

export function loadAssuranceRegister(root = repoRoot) {
  const path = join(root, "compliance", "assurance-register.json");
  if (!existsSync(path)) throw new Error("Mangler compliance/assurance-register.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadDataRegister(root = repoRoot) {
  const path = join(root, "compliance", "data-register.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function loadControlIds(root = repoRoot) {
  const path = join(root, "compliance", "control-mapping.json");
  if (!existsSync(path)) return null;
  const mapping = JSON.parse(readFileSync(path, "utf8"));
  return [...(mapping.controls ?? []).map((c) => c.id), ...(mapping.frameworks ?? []).flatMap((f) => (f.requirements ?? []).map((r) => r.id))];
}

/** Validér registeret mod skema og semantik; kast hvis det ikke er konsistent. */
export function checkRegister(register = loadAssuranceRegister(), options = {}) {
  const { ajv } = buildAjv({ strict: true });
  const { ok, errors } = validate(ajv, SCHEMA_IDS.assuranceRegister, register);
  const problems = ok ? [] : errors.map((e) => `${e.path || "/"} ${e.message}`);
  if (problems.length === 0) {
    for (const p of assuranceRegisterProblems(register, { dataRegister: loadDataRegister(), controlIds: loadControlIds() })) {
      problems.push(`${p.path} ${p.message}`);
    }
  }
  if (problems.length) throw new Error("assurance-registeret er inkonsistent:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  return register;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

export function renderAssuranceDoc(register) {
  const lines = [];
  lines.push("<!-- GENERERET af compliance/src/assurance-cli.mjs fra compliance/assurance-register.json. Redigér registeret, ikke denne fil. -->");
  lines.push("");
  lines.push("# Evidens- og risikoregister");
  lines.push("");
  lines.push(register.metadata.description);
  lines.push("");
  lines.push(`Version ${register.metadata.version} · sidst gennemgået ${register.metadata.lastReviewed} · **certificering:** nej (registeret er en påstand om mekanismer og beslutninger).`);
  lines.push("");
  lines.push("## Rollefordeling");
  lines.push("");
  lines.push(`- **Udgiver:** ${register.roleStatement.issuer}`);
  lines.push(`- **Deployer:** ${register.roleStatement.deployer}`);
  lines.push(`- **Delt:** ${register.roleStatement.shared}`);
  lines.push("");
  lines.push("## Anvendelighed efter brug, rolle og sektor");
  lines.push("");
  lines.push("| Framework | Brug | Sektor | Rolle | Anvendelig | Vurderet af |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const app of register.applicability) {
    lines.push(`| ${app.framework} | ${app.use} | ${app.sector} | ${app.role} | ${app.applicable ? "ja" : "nej"} | ${app.assessedBy.name} |`);
  }
  lines.push("");
  lines.push("## DPIA-screening");
  lines.push("");
  lines.push("| Screening | Behandling | Resultat | DPIA | Vurderet af | Blokerer |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const s of register.dataProtection.dpiaScreenings) {
    lines.push(`| \`${s.id}\` | ${s.processingRef} | ${s.outcome} | ${s.dpiaRef ?? "—"} | ${s.assessedBy?.name ?? "—"} | ${s.pendingBlocker ? "ja" : "nej"} |`);
  }
  lines.push("");
  lines.push("## Databehandleraftaler");
  lines.push("");
  lines.push("| Aftale | Part | Aftale-reference | Godkendt af | Underdatabehandlere |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const a of register.dataProtection.processorAgreements) {
    lines.push(`| \`${a.id}\` | ${a.party} | ${a.dpaRef} | ${a.approvedBy.name} | ${a.subprocessorRefs.join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Overførselsvurdering");
  lines.push("");
  lines.push("| Vurdering | Underdatabehandler | Status | Grundlag | Vurderet af |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const t of register.dataProtection.transferAssessments) {
    lines.push(`| \`${t.id}\` | ${t.subprocessorRef} | ${t.status} | ${t.mechanisms.join(", ") || "—"} | ${t.assessedBy?.name ?? "—"} |`);
  }
  lines.push("");
  lines.push("## Incident, adgangsrevision, informationspligt og exit");
  lines.push("");
  lines.push(`- Incidentproces: \`${register.incidentAndExit.incidentProcessRef}\``);
  for (const d of register.incidentAndExit.notificationDuties) {
    lines.push(`- Indberetning \`${d.id}\` (${d.regime}): inden ${d.deadlineHours} timer til ${d.recipient}, ejer ${d.owner.name}`);
  }
  lines.push(`- Adgangsrevision hvert ${register.incidentAndExit.accessReview.frequencyDays}. døgn, ejer ${register.incidentAndExit.accessReview.owner.name}; senest ${register.incidentAndExit.accessReview.lastReviewedAt}`);
  lines.push(`- Informationspligt: \`${register.incidentAndExit.informationDuty.procedureRef}\`, ejer ${register.incidentAndExit.informationDuty.owner.name}`);
  lines.push(`- Kundens exit: \`${register.incidentAndExit.exitProcedure.procedureRef}\` (eksport: ${register.incidentAndExit.exitProcedure.dataExport ? "ja" : "nej"}, sletning: ${register.incidentAndExit.exitProcedure.deletion ? "ja" : "nej"}, ${register.incidentAndExit.exitProcedure.transitionDays} dage)`);
  lines.push("");
  lines.push("## Kravregister");
  lines.push("");
  lines.push("| Krav | Kilde | Dato | Ansvarlig | Status | Kontrol | Evidens | Beslutning |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of register.requirements) {
    lines.push(`| \`${r.id}\` | ${r.source} | ${r.sourceDate} | ${r.owner.name} | ${r.status} | ${r.controlRef} | ${r.evidenceRefs.join(", ") || "—"} | ${r.decisionRef ?? "—"} |`);
  }
  lines.push("");
  lines.push("## Risici");
  lines.push("");
  lines.push("| Risiko | Kategori | Ejer | Restrisiko | Status | Blokerer pilot |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const risk of register.risks) {
    lines.push(`| \`${risk.id}\` ${risk.title} | ${risk.category} | ${risk.owner.name} | ${risk.residualRisk} | ${risk.status} | ${risk.blocksPersonalDataPilot ? "ja" : "nej"} |`);
  }
  lines.push("");
  lines.push("## Juridiske og organisatoriske beslutninger");
  lines.push("");
  lines.push("| Beslutning | Type | Status | Ansvarlig | Truffet af | Dato |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const d of register.decisions) {
    lines.push(`| \`${d.id}\` ${d.title} | ${d.kind} | ${d.status} | ${d.responsible.name} | ${d.ownerDecision?.name ?? "—"} | ${d.ownerDecision?.date ?? "—"} |`);
  }
  lines.push("");
  const blockers = pilotBlockers(register);
  lines.push("## Blokere for en pilot med persondata");
  lines.push("");
  if (blockers.length === 0) {
    lines.push("Ingen åbne blokere fundet i registeret. Det er ikke en certificering og ikke et driftsbevis.");
  } else {
    for (const b of blockers) lines.push(`- **${b.kind}** \`${b.id}\`: ${b.reason}`);
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

/* -------------------------------------------------------------------------- */
/* Evidenspakke                                                               */
/* -------------------------------------------------------------------------- */

function stablePackageId(register, generatedAt) {
  return `assurance-package-${createHash("sha256").update(`${register.metadata.name}:${register.metadata.version}:${generatedAt}`).digest("hex").slice(0, 12)}`;
}

/**
 * Saml den aktuelle evidenspakke.
 *
 * @param {object} opts
 * @param {object} opts.register
 * @param {Map|object|Array} opts.evidenceRecords   Evidensposter (id → record eller liste).
 * @param {number} [opts.now]
 * @param {object} [opts.expected]                   `{ commit, imageDigest, environment, upstreamVersion }`.
 * @param {object} [opts.trustKeys]
 * @param {boolean} [opts.requireSignature]
 */
export function assembleEvidencePackage({ register, evidenceRecords = [], now = Date.now(), expected = {}, trustKeys = null, requireSignature = false, registerCommit = null, generatedAt = new Date(now).toISOString() } = {}) {
  const byId = new Map();
  if (evidenceRecords instanceof Map) {
    for (const [id, record] of evidenceRecords) byId.set(id, record);
  } else if (Array.isArray(evidenceRecords)) {
    for (const entry of evidenceRecords) {
      if (entry?.record) byId.set(entry.record.id, entry.record);
      else if (entry?.id) byId.set(entry.id, entry);
    }
  } else if (evidenceRecords && typeof evidenceRecords === "object") {
    for (const [id, record] of Object.entries(evidenceRecords)) byId.set(id, record);
  }

  const rejectedEvidence = [];
  const missingAssessments = [];
  const requirements = [];
  let verified = 0;
  let missing = 0;

  for (const req of register.requirements ?? []) {
    const coverage = [];
    let eligible = 0;
    let fixtureOnly = false;
    const blockers = [];
    for (const ref of req.evidenceRefs ?? []) {
      const record = byId.get(ref);
      if (!record) {
        coverage.push({ ref, status: "missing", mode: null, reason: "ingen evidenspost fundet" });
        missing += 1;
        continue;
      }
      const assessment = assessRecord(record, { now, expected, trustKeys, requireSignature });
      coverage.push({ ref, status: assessment.status, mode: record.mode ?? null, reason: assessment.reasons.join("; ") || null });
      if (assessment.eligible) eligible += 1;
      else if (assessment.status === "fixture-only") fixtureOnly = true;
      else {
        rejectedEvidence.push({ ref, status: assessment.status, reason: assessment.reasons.join("; ") || "afvist" });
        blockers.push(`evidens '${ref}' er ${assessment.status}`);
      }
    }
    if (eligible === 0 && fixtureOnly) blockers.push("kun fixture/contract-evidens — beviser ikke drift");
    if (eligible === 0 && (req.evidenceRefs ?? []).length === 0) blockers.push("kravet mangler evidenslink");
    for (const b of blockers) missingAssessments.push({ kind: "evidence", id: req.id, reason: b });
    if (eligible > 0 && blockers.length === 0) verified += 1;

    const decision = (register.decisions ?? []).find((d) => d.id === req.decisionRef);
    requirements.push({
      requirementId: req.id,
      title: req.title,
      status: req.status,
      owner: req.owner,
      controlRef: req.controlRef,
      coverage,
      humanDecision: decision?.ownerDecision ?? null,
      blockers,
    });
  }

  const humanDecisions = (register.decisions ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    status: d.status,
    decidedBy: d.ownerDecision ? { subject: d.ownerDecision.subject, name: d.ownerDecision.name, role: d.ownerDecision.role } : null,
    date: d.ownerDecision?.date ?? null,
    decisionRef: d.ownerDecision?.decisionRef ?? null,
  }));

  for (const d of register.decisions ?? []) {
    if (d.status === "open") missingAssessments.push({ kind: "decision", id: d.id, reason: d.rationale });
  }
  for (const s of register.dataProtection?.dpiaScreenings ?? []) {
    if (s.outcome === "pending" || s.pendingBlocker === true) missingAssessments.push({ kind: "dpia", id: s.id, reason: s.reason });
    if (s.outcome === "required" && !s.dpiaRef) missingAssessments.push({ kind: "dpia", id: s.id, reason: "påkrævet DPIA mangler dokumentreference" });
  }
  for (const t of register.dataProtection?.transferAssessments ?? []) {
    if (t.status === "pending") missingAssessments.push({ kind: "transfer", id: t.id, reason: t.note });
  }

  const blockers = pilotBlockers(register);
  const productionReady = requirements.length > 0 && requirements.every((r) => r.coverage.some((c) => c.status === "eligible")) && blockers.length === 0 && rejectedEvidence.length === 0 && missingAssessments.length === 0;
  let badge = "none";
  if (productionReady) badge = "production";
  else if (requirements.some((r) => r.coverage.some((c) => NON_PRODUCTION_MODES.includes(c.mode)))) badge = "fixture-only";
  else if (requirements.some((r) => r.coverage.some((c) => c.status === "missing"))) badge = "missing";
  else if (rejectedEvidence.length > 0) badge = "rejected";

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EvidencePackage",
    packageId: stablePackageId(register, generatedAt),
    generatedAt,
    registerVersion: register.metadata.version,
    registerCommit,
    notACertification: true,
    complianceStatus: "not-certified",
    productionReady,
    badge,
    acceptedBy: null,
    acceptedAt: null,
    requirements,
    humanDecisions,
    missingAssessments,
    rejectedEvidence,
    pilotBlockers: blockers,
    summary: {
      requirements: requirements.length,
      verified,
      missing,
      humanDecisions: humanDecisions.length,
      rejectedEvidence: rejectedEvidence.length,
      pilotBlockers: blockers.length,
    },
  };
}

/** Læs evidensposter fra en mappe som en `id → record`-Map. */
export function loadEvidenceRecordMap(dir) {
  const map = new Map();
  for (const entry of loadEvidenceRecords(dir)) {
    if (entry.record?.id) map.set(entry.record.id, entry.record);
  }
  return map;
}
