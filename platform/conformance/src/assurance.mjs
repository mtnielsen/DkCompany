/**
 * DKC-022 — semantiske validatorer for evidens- og risikoregisteret samt
 * evidenspakken.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke:
 *
 *   - hver åben juridisk/organisatorisk beslutning har en ansvarlig person,
 *   - DPIA-screening, databehandleraftaler, underdatabehandlere og
 *     overførselsvurderinger er enten afsluttet af et navngivet menneske eller
 *     eksplicit markeret som udestående og blokerende,
 *   - AI Act-/NIS2-anvendelighed er vurderet efter brug, rolle og sektor,
 *   - hvert krav har kilde, dato, ansvarlig, status og evidenslink (eller er
 *     eksplicit markeret `missing-evidence`),
 *   - en væsentlig, åben risiko blokerer en pilot med persondata,
 *   - et badge er ikke en certificering, og udestående vurderinger og afvist
 *     evidens kan ikke samtidig give `productionReady`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

function err(path, message) {
  return { path, message };
}

function readDir(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

function withSchema(schemaId, data, ajv, semantic) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...semantic(data));
  return { ok: problems.length === 0, errors: problems };
}

/** Beslutningssemantik for registeret. Returnerer en liste af problemer. */
export function assuranceRegisterProblems(register, { dataRegister = null, controlIds = null } = {}) {
  const problems = [];
  if (!register) return [err("/", "assurance-registeret mangler")];

  if (register.metadata?.certificationClaim !== false) {
    problems.push(err("/metadata/certificationClaim", "registeret må ikke hævde en certificering"));
  }

  const dataEntryIds = new Set((dataRegister?.entries ?? []).map((e) => e.id));
  const dataSubprocessors = new Set((dataRegister?.subprocessors ?? []).map((s) => s.id));
  const controlSet = controlIds ? new Set(controlIds) : null;

  // 1) Anvendelighed efter brug, rolle og sektor.
  const frameworks = new Set();
  for (const [i, app] of (register.applicability ?? []).entries()) {
    frameworks.add(app.framework);
    if (!isNamedHuman(app.assessedBy)) problems.push(err(`/applicability/${i}/assessedBy`, "anvendelighed skal vurderes af et navngivet menneske"));
    if (!(app.rationale ?? "").trim()) problems.push(err(`/applicability/${i}/rationale`, "anvendelighed skal have en begrundelse"));
  }
  for (const framework of ["nis2", "ai-act", "gdpr"]) {
    if (!frameworks.has(framework)) problems.push(err("/applicability", `anvendeligheden mangler framework '${framework}'`));
  }

  // 2) DPIA-screening, databehandleraftaler og overførselsvurdering.
  const dpia = register.dataProtection ?? {};
  for (const [i, screening] of (dpia.dpiaScreenings ?? []).entries()) {
    const path = `/dataProtection/dpiaScreenings/${i}`;
    if (dataEntryIds.size && !dataEntryIds.has(screening.processingRef)) {
      problems.push(err(`${path}/processingRef`, `DPIA-screeningen peger på den ukendte behandling '${screening.processingRef}'`));
    }
    if (screening.outcome === "required") {
      if (!screening.dpiaRef) problems.push(err(`${path}/dpiaRef`, "en påkrævet DPIA skal have en dokumentreference"));
      if (!isNamedHuman(screening.assessedBy)) problems.push(err(`${path}/assessedBy`, "en påkrævet DPIA skal være vurderet af et navngivet menneske"));
    } else if (screening.outcome === "pending") {
      if (screening.pendingBlocker !== true) problems.push(err(`${path}/pendingBlocker`, "en udestående DPIA-screening skal markeres som blokerende"));
    } else if (screening.outcome === "not-required") {
      if (!isNamedHuman(screening.assessedBy)) problems.push(err(`${path}/assessedBy`, "en 'ikke påkrævet'-screening skal være afgjort af et navngivet menneske"));
      if (screening.dpiaRef) problems.push(err(`${path}/dpiaRef`, "en 'ikke påkrævet'-screening må ikke pege på en DPIA"));
    }
  }
  for (const [i, agreement] of (dpia.processorAgreements ?? []).entries()) {
    const path = `/dataProtection/processorAgreements/${i}`;
    if (!isNamedHuman(agreement.approvedBy)) problems.push(err(`${path}/approvedBy`, "en databehandleraftale skal godkendes af et navngivet menneske"));
    for (const ref of agreement.subprocessorRefs ?? []) {
      if (dataSubprocessors.size && !dataSubprocessors.has(ref)) problems.push(err(`${path}/subprocessorRefs`, `databehandleraftalen peger på den ukendte underdatabehandler '${ref}'`));
    }
  }
  for (const [i, transfer] of (dpia.transferAssessments ?? []).entries()) {
    const path = `/dataProtection/transferAssessments/${i}`;
    if (dataSubprocessors.size && !dataSubprocessors.has(transfer.subprocessorRef)) {
      problems.push(err(`${path}/subprocessorRef`, `overførselsvurderingen peger på den ukendte underdatabehandler '${transfer.subprocessorRef}'`));
    }
    if (transfer.status !== "pending" && !isNamedHuman(transfer.assessedBy)) {
      problems.push(err(`${path}/assessedBy`, "en afsluttet overførselsvurdering skal være udført af et navngivet menneske"));
    }
    if (transfer.status === "present" && (transfer.mechanisms ?? []).length === 0) {
      problems.push(err(`${path}/mechanisms`, "en tilstedeværende overførsel skal angive et overførselsgrundlag"));
    }
  }

  // 3) Incidentproces, adgangsrevision, informationspligt og exit.
  const ie = register.incidentAndExit ?? {};
  for (const [i, duty] of (ie.notificationDuties ?? []).entries()) {
    if (!isNamedHuman(duty.owner)) problems.push(err(`/incidentAndExit/notificationDuties/${i}/owner`, "en indberetningspligt skal have et navngivet menneske som ejer"));
  }
  if (!isNamedHuman(ie.accessReview?.owner)) problems.push(err("/incidentAndExit/accessReview/owner", "adgangsrevisionen skal have et navngivet menneske som ejer"));
  if (!isNamedHuman(ie.informationDuty?.owner)) problems.push(err("/incidentAndExit/informationDuty/owner", "informationspligten skal have et navngivet menneske som ejer"));
  if (!isNamedHuman(ie.exitProcedure?.owner)) problems.push(err("/incidentAndExit/exitProcedure/owner", "exitproceduren skal have et navngivet menneske som ejer"));
  if (ie.exitProcedure && (ie.exitProcedure.dataExport !== true || ie.exitProcedure.deletion !== true)) {
    problems.push(err("/incidentAndExit/exitProcedure", "kundens exitprocedure skal omfatte både dataeksport og sletning"));
  }

  // 4) Kravregister: kilde, dato, ansvarlig, status og evidenslink.
  const requirementIds = new Set((register.requirements ?? []).map((r) => r.id));
  const riskIds = new Set((register.risks ?? []).map((r) => r.id));
  const decisionIds = new Set((register.decisions ?? []).map((d) => d.id));
  for (const [i, req] of (register.requirements ?? []).entries()) {
    const path = `/requirements/${i}`;
    if (!isNamedHuman(req.owner)) problems.push(err(`${path}/owner`, "kravet skal have et navngivet menneske som ansvarlig"));
    if (!(req.source ?? "").trim()) problems.push(err(`${path}/source`, "kravet mangler en kilde"));
    if (!(req.sourceDate ?? "").trim()) problems.push(err(`${path}/sourceDate`, "kravet mangler en kildedato"));
    if (controlSet && !controlSet.has(req.controlRef)) problems.push(err(`${path}/controlRef`, `kravet peger på den ukendte kontrol '${req.controlRef}'`));
    if (req.status !== "missing-evidence" && (req.evidenceRefs ?? []).length === 0) {
      problems.push(err(`${path}/evidenceRefs`, "et krav uden evidens skal markeres 'missing-evidence'"));
    }
    if (req.decisionRef && !decisionIds.has(req.decisionRef)) problems.push(err(`${path}/decisionRef`, `kravet peger på den ukendte beslutning '${req.decisionRef}'`));
    for (const ref of req.riskRefs ?? []) {
      if (!riskIds.has(ref)) problems.push(err(`${path}/riskRefs`, `kravet peger på den ukendte risiko '${ref}'`));
    }
  }

  // 5) Risici: en væsentlig, åben risiko blokerer persondatapilot.
  for (const [i, risk] of (register.risks ?? []).entries()) {
    const path = `/risks/${i}`;
    if (!isNamedHuman(risk.owner)) problems.push(err(`${path}/owner`, "risikoen skal have et navngivet menneske som ejer"));
    const high = risk.residualRisk === "high" || risk.residualRisk === "critical";
    if (high && risk.status === "open" && (risk.material !== true || risk.blocksPersonalDataPilot !== true)) {
      problems.push(err(path, "en åben høj/kritisk risiko skal markeres material og blokere persondatapilot"));
    }
    if (risk.status === "accepted" && !risk.assessmentRef) {
      problems.push(err(`${path}/assessmentRef`, "en accepteret risiko skal have en dokumenteret vurdering"));
    }
    for (const ref of risk.requirementRefs ?? []) {
      if (!requirementIds.has(ref)) problems.push(err(`${path}/requirementRefs`, `risikoen peger på det ukendte krav '${ref}'`));
    }
  }

  // 6) Beslutninger: hver åben beslutning har en ansvarlig; en afsluttet har en
  //    navngiven menneskelig beslutning.
  for (const [i, decision] of (register.decisions ?? []).entries()) {
    const path = `/decisions/${i}`;
    if (!isNamedHuman(decision.responsible)) problems.push(err(`${path}/responsible`, "hver beslutning skal have en ansvarlig person"));
    if (decision.status === "open") {
      if (decision.ownerDecision) problems.push(err(`${path}/ownerDecision`, "en åben beslutning må ikke have en ejerbeslutning"));
      if (decision.blocksPersonalDataPilot !== true) problems.push(err(`${path}/blocksPersonalDataPilot`, "en åben juridisk/organisatorisk beslutning skal blokere persondatapilot"));
    } else if (!isNamedHuman(decision.ownerDecision)) {
      problems.push(err(`${path}/ownerDecision`, "en afsluttet beslutning skal være truffet af et navngivet menneske"));
    }
  }

  return problems;
}

/** Blokerende forhold for en pilot med persondata. */
export function pilotBlockers(register) {
  const blockers = [];
  for (const screening of register?.dataProtection?.dpiaScreenings ?? []) {
    if (screening.outcome === "pending" || screening.pendingBlocker === true) {
      blockers.push({ kind: "dpia", id: screening.id, reason: screening.reason || "DPIA-screening er udestående" });
    }
  }
  for (const transfer of register?.dataProtection?.transferAssessments ?? []) {
    if (transfer.status === "pending") blockers.push({ kind: "transfer", id: transfer.id, reason: transfer.note || "overførselsvurdering er udestående" });
  }
  for (const decision of register?.decisions ?? []) {
    if (decision.status === "open") blockers.push({ kind: "decision", id: decision.id, reason: decision.rationale || "beslutning er åben" });
  }
  for (const risk of register?.risks ?? []) {
    if (risk.material === true && risk.blocksPersonalDataPilot === true && risk.status === "open") {
      blockers.push({ kind: "risk", id: risk.id, reason: risk.mitigation || "væsentlig risiko er åben" });
    }
  }
  return blockers;
}

/** Semantik for en samlet evidenspakke. */
export function assurancePackageProblems(pkg) {
  const problems = [];
  if (!pkg) return [err("/", "evidenspakken mangler")];
  if (pkg.notACertification !== true) problems.push(err("/notACertification", "en evidenspakke er ikke en certificering"));
  if (pkg.complianceStatus !== "not-certified") problems.push(err("/complianceStatus", "eksport må ikke automatisk erklære platformen compliant"));
  if (pkg.productionReady === true) {
    if (pkg.badge !== "production") problems.push(err("/badge", "productionReady kræver badge 'production'"));
    if ((pkg.pilotBlockers ?? []).length > 0) problems.push(err("/pilotBlockers", "en pakke med pilot-blockere kan ikke være productionReady"));
    if ((pkg.missingAssessments ?? []).length > 0) problems.push(err("/missingAssessments", "en pakke med manglende vurderinger kan ikke være productionReady"));
    if ((pkg.rejectedEvidence ?? []).length > 0) problems.push(err("/rejectedEvidence", "en pakke med afvist evidens kan ikke være productionReady"));
  }
  if (pkg.acceptedBy && !pkg.acceptedAt) problems.push(err("/acceptedAt", "en accepteret pakke skal have et accepttidspunkt"));
  const s = pkg.summary ?? {};
  const expected = {
    requirements: (pkg.requirements ?? []).length,
    humanDecisions: (pkg.humanDecisions ?? []).length,
    rejectedEvidence: (pkg.rejectedEvidence ?? []).length,
    pilotBlockers: (pkg.pilotBlockers ?? []).length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (s[key] !== value) problems.push(err(`/summary/${key}`, `summary.${key} (${s[key]}) matcher ikke antallet (${value})`));
  }
  return problems;
}

export function validateAssuranceRegister(data, ajv, opts) {
  return withSchema(SCHEMA_IDS.assuranceRegister, data, ajv, (d) => assuranceRegisterProblems(d, opts));
}

export function validateEvidencePackage(data, ajv) {
  return withSchema(SCHEMA_IDS.evidencePackage, data, ajv, assurancePackageProblems);
}

function validateDir(dir, prefix, validator, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validator(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}

export function validateAssuranceRegisterDir(dir, ajv) {
  return validateDir(dir, "assurance-register", validateAssuranceRegister, ajv);
}

export function validateEvidencePackageDir(dir, ajv) {
  return validateDir(dir, "evidence-package", validateEvidencePackage, ajv);
}
