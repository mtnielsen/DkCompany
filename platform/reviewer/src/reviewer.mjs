export class ReviewerError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewerError";
  }
}

const ALLOWED_VERDICTS = ["no-objection", "flag", "reject"];

/**
 * Adversarial reviewer-agent.
 *
 * - Skal være fra en anden leverandør end forfatteren. Samme model i en anden
 *   prompt giver korrelerede fejl, ikke uafhængighed.
 * - Ser ændring + rådata — ikke forfatterens begrundelse. Ellers ankrær den.
 * - Kan kun flagge eller afvise. Den kan ikke godkende og ikke ændre
 *   autonomiklasse (det er A4-territorium).
 */
export function createReviewerAgent({ provider, providerName, authorProvider, model = null, authorModel = null, role = "verifier", reviewerRef = "reviewer" }) {
  if (!provider?.review) throw new ReviewerError("kræver en provider med review()");
  if (!providerName || !authorProvider) throw new ReviewerError("providerName og authorProvider kræves");
  if (providerName === authorProvider) throw new ReviewerError("reviewer skal have en anden leverandør end forfatteren");
  // DKC-055: en reviewer er en verifier-rolle — aldrig en godkender — og må
  // ikke forlade sig på samme model som forfatteren. Samme model i en anden
  // isoleret identitet giver korrelerede fejl, ikke uafhængig modelkvalitet.
  if (role !== "verifier") throw new ReviewerError(`reviewer-agenten skal have rollen 'verifier', ikke '${role}'`);
  if (model && authorModel && model === authorModel) throw new ReviewerError("samme model som forfatteren tæller ikke som uafhængig modelkvalitet");

  async function review({ change, rawData }) {
    // Ingen rationale-parameter: forfatterens begrundelse sendes bevidst ikke videre.
    const result = await provider.review({ change, rawData });
    const findings = Array.isArray(result.findings) ? [...result.findings] : [];
    let rejectedAutonomyChange = false;
    if (result.autonomyClass !== undefined) {
      rejectedAutonomyChange = true;
      findings.push(`afvist: reviewer må ikke ændre autonomiklasse (forsøgte '${result.autonomyClass}')`);
    }
    const verdict = ALLOWED_VERDICTS.includes(result.verdict) ? result.verdict : "flag";
    return {
      reviewerRef,
      provider: providerName,
      verdict,
      findings,
      sawAuthorRationale: false,
      ...(rejectedAutonomyChange ? { rejectedAutonomyChange: true } : {}),
    };
  }

  return { review, reviewerRef, provider: providerName };
}
