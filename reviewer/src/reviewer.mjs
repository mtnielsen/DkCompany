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
export function createReviewerAgent({ provider, providerName, authorProvider, reviewerRef = "reviewer" }) {
  if (!provider?.review) throw new ReviewerError("kræver en provider med review()");
  if (!providerName || !authorProvider) throw new ReviewerError("providerName og authorProvider kræves");
  if (providerName === authorProvider) throw new ReviewerError("reviewer skal have en anden leverandør end forfatteren");

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
