/**
 * DKC-004 — semantiske validatorer for godkendelsesanmodninger.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, skemaet
 * ikke kan udtrykke:
 *
 *   - bindingen mellem beslutning og ændring skal være intakt (server-computed)
 *   - unikke godkendere: samme identitet må ikke optræde to gange
 *   - ingen selv-godkendelse af egen ændring
 *   - hver godkendelse skal være bundet til samme digest som beslutningen
 *   - tilstanden skal være konsistent med antallet af godkendelser
 *   - tilbagekaldelse/udløb skal være tidsstemplet
 *
 * Validatorerne er rene funktioner og kan kaldes fra CI, tests og installeren.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { bindingDrift } from "../../approvals/src/binding.mjs";

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

/** Semantiske problemer for én godkendelsesanmodning. */
export function approvalProblems(data) {
  const problems = [];
  const decision = data?.decision ?? {};

  problems.push(...bindingDrift(data).map((m) => err("/decision/binding", m)));

  const seen = new Set();
  const approvals = decision.approvals ?? [];
  for (const [i, a] of approvals.entries()) {
    if (seen.has(a.subject)) problems.push(err(`/decision/approvals/${i}/subject`, `dubleret godkender '${a.subject}' — unikke godkendere kræves`));
    seen.add(a.subject);
    if (decision.requestedBy && a.subject === decision.requestedBy) {
      problems.push(err(`/decision/approvals/${i}/subject`, "anmoderen må ikke godkende sin egen ændring"));
    }
    if (decision.binding?.digest && a.bindingDigest && a.bindingDigest !== decision.binding.digest) {
      problems.push(err(`/decision/approvals/${i}/bindingDigest`, "godkendelsen er bundet til en anden ændring end beslutningen"));
    }
    if (a.verdict === "approve" && (decision.requiredTrainingModules ?? []).length && a.trainingVerified !== true) {
      problems.push(err(`/decision/approvals/${i}/trainingVerified`, "godkenderen mangler serververificeret træning"));
    }
  }

  const approveCount = approvals.filter((a) => a.verdict === "approve").length;
  const required = decision.requiredApprovals ?? 1;
  if (decision.state === "approved" && approveCount < required) {
    problems.push(err("/decision/state", `'approved' kræver mindst ${required} godkendelser (har ${approveCount})`));
  }
  if (decision.state === "pending" && approveCount >= required) {
    problems.push(err("/decision/state", `'pending' med ${approveCount} godkendelser er inkonsistent (kræver ${required})`));
  }
  if (decision.state === "revoked" && !decision.revokedAt) problems.push(err("/decision/revokedAt", "tilbagekaldt beslutning skal have revokedAt"));
  if (decision.state === "expired" && !decision.expiredAt) problems.push(err("/decision/expiredAt", "udløbet beslutning skal have expiredAt"));
  if (decision.state === "withdrawn" && !decision.withdrawnAt) problems.push(err("/decision/withdrawnAt", "trukket tilbage-beslutning skal have withdrawnAt"));

  if (decision.consumed) {
    if (decision.state !== "approved") {
      problems.push(err("/decision/consumed", "kun en 'approved' beslutning kan forbruges"));
    }
    if (decision.binding?.digest && decision.consumed.bindingDigest && decision.consumed.bindingDigest !== decision.binding.digest) {
      problems.push(err("/decision/consumed/bindingDigest", "forbruget er bundet til en anden ændring end beslutningen"));
    }
  }

  return problems;
}

/** Kør skema + semantik for én anmodning. */
export function validateApprovalRequest(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.approvalRequest, data)];
  if (errors.length === 0) errors.push(...approvalProblems(data));
  return { ok: errors.length === 0, errors };
}

/** Find og validér approval-eksempler i en mappe. */
export function validateApprovalDir(dir) {
  const ajv = buildAjv().ajv;
  const results = [];
  if (!dir) return results;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    if (!file.startsWith("approval-request")) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validateApprovalRequest(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}
