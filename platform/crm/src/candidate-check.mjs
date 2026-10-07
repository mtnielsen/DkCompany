/**
 * DKC-030 — kandidatcheck: EspoCRM eller ERPNext.
 *
 * To kandidater vurderes på de egenskaber der afgør en CRM-kerne bag den
 * fælles adapter-SDK: obligatorisk OIDC-SSO, et dokumenteret REST-API,
 * tenantisolation, API-eksport, provisionering og licens. Den højeste samlede
 * score vinder; en kandidat kan ikke være "godkendt" så længe en nødvendig
 * egenskab er ukendt (DKC-023's hårde gate). Valget er deterministisk og
 * dokumenteres i rapporten.
 *
 * Bemærk: en kandidat er **ikke** godkendt af et menneske i dette miljø
 * (`candidate_not_approved`); valget er derfor en teknisk rangering, ikke en
 * frigivelsesgodkendelse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessCandidateGate } from "../../adapter-sdk/src/candidates.mjs";
import { repoRoot } from "../../conformance/src/schemas.mjs";

export const CANDIDATE_FILES = {
  espocrm: "integration-candidate.espocrm.example.json",
  erpnext: "integration-candidate.erpnext.example.json",
};

/** Den valgte kandidat. Holdes eksplicit, så en ændring i rangeringen er synlig. */
export const SELECTED_PROVIDER = "espocrm";

export function loadCandidate(root, product) {
  const file = CANDIDATE_FILES[product];
  if (!file) throw new Error(`ukendt kandidat-produkt '${product}'`);
  return JSON.parse(readFileSync(join(root, "contracts", "examples", file), "utf8"));
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
  const gate = assessCandidateGate({ candidate });
  score -= gate.blockers.length;
  return { score, reasons, gate };
}

/** Evaluer begge kandidater og vælg den bedste. */
export function evaluateCandidates(root = repoRoot) {
  const scored = Object.keys(CANDIDATE_FILES)
    .map((product) => {
      const candidate = loadCandidate(root, product);
      return { product, file: CANDIDATE_FILES[product], candidate, ...scoreCandidate(candidate) };
    })
    .sort((a, b) => b.score - a.score || a.product.localeCompare(b.product));
  const selected = scored[0];
  return {
    candidates: scored.map(({ product, file, candidate, score, reasons, gate }) => ({
      product,
      file,
      name: candidate.name,
      exactVersion: candidate.exactVersion,
      score,
      reasons,
      gateStatus: gate.status,
      blockers: gate.blockers,
    })),
    selected: selected.product,
    selectedScore: selected.score,
    matchesDeclaration: selected.product === SELECTED_PROVIDER,
  };
}
