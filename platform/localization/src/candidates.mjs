/**
 * DKC-035 — kandidatvurdering pr. forretningsmodulfamilie.
 *
 * Genbruger DKC-023's hårde godkendelsesgate: en kandidat kan ikke være
 * 'godkendt', så længe en nødvendig egenskab er ukendt. Et katalogprodukt er
 * derfor en teknisk rangering — ikke en frigivelsesgodkendelse. Den valgte
 * kandidat holdes eksplicit, så en ændring i rangeringen er synlig.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessCandidateGate } from "../../adapter-sdk/src/candidates.mjs";

export function loadCandidate(root, candidateRef) {
  return JSON.parse(readFileSync(join(root, "contracts", "examples", candidateRef), "utf8"));
}

/** Score én kandidat ud fra de egenskaber platformen kræver. */
export function scoreCandidate(candidate) {
  let score = 0;
  const reasons = [];
  if (candidate.sso?.supported === true && (candidate.sso.protocols ?? []).includes("oidc")) {
    score += 3;
    reasons.push("OIDC-SSO");
  }
  if (candidate.api?.documented === true && (candidate.api.protocols ?? []).includes("rest")) {
    score += 2;
    reasons.push("dokumenteret REST-API");
  }
  if (candidate.isolation?.capability === "full" && candidate.isolation?.databasePerTenant === true) {
    score += 2;
    reasons.push("dedikeret database pr. tenant");
  }
  if (candidate.export?.apiAccessible === true) {
    score += 1;
    reasons.push("API-eksport");
  }
  if (["open-source", "mixed"].includes(candidate.license?.type)) {
    score += 1;
    reasons.push("fri/åben kerne");
  }
  if (candidate.backup?.restoreTested === true) {
    score += 1;
    reasons.push("testet gendannelse");
  }
  const gate = assessCandidateGate({ candidate });
  score -= gate.blockers.length;
  return { score, reasons, gate };
}

/** Evaluer alle kandidater i én familie og markér den erklærede vinder. */
export function evaluateFamilyCandidates(root, family) {
  const scored = (family.candidateProducts ?? []).map((cp) => {
    const candidate = loadCandidate(root, cp.candidateRef);
    const { score, reasons, gate } = scoreCandidate(candidate);
    return {
      product: cp.product,
      candidateRef: cp.candidateRef,
      declaredSelected: cp.selected === true,
      reason: cp.reason,
      name: candidate.name,
      exactVersion: candidate.exactVersion,
      score,
      reasons,
      gateStatus: gate.status,
      blockers: gate.blockers,
    };
  });
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.product.localeCompare(b.product));
  const best = sorted[0] ?? null;
  const declared = scored.find((c) => c.declaredSelected) ?? null;
  return {
    family: family.id,
    candidates: scored,
    selected: declared?.product ?? null,
    bestByScore: best?.product ?? null,
    matchesDeclaration: Boolean(declared && best && best.product === declared.product),
    selectedGateStatus: declared?.gateStatus ?? "blocked",
    selectedBlockers: declared?.blockers ?? ["ingen valgt kandidat"],
  };
}
