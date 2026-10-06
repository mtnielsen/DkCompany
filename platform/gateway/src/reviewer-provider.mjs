/**
 * DKC-012 — reviewerens reelle leverandør gennem gatewayen.
 *
 * Reviewer-agenten kræver en `provider` med `review()`, og den skal være fra en
 * anden leverandør end forfatteren. Denne adapter forbinder reviewerens
 * `review()`-interface til gatewayens serverstyrede route, så revieweren ikke
 * får egen leverandøradgang: den kalder samme gateway som alle andre.
 *
 * Vælgeren af leverandør er routetabellen (og dermed serveren). Adapteren
 * dokumenterer hvilken provider den reelle reviewer-route peger på, og
 * `createReviewerAgent` afviser stadig samme leverandør som forfatteren.
 */
import { createGatewayAccounting } from "./accounting.mjs";

/**
 * @param {object} options
 * @param {Function} options.complete     gateway-klientens `complete()` (fx fra runtime/src/clients.mjs)
 * @param {string} options.providerName   leverandørnavnet routen peger på (fx "openai")
 * @param {string} [options.model]        modelnavn routen peger på
 * @param {string} [options.agentRef]     reviewer-agentens ref
 * @param {string} [options.dataClass]    dataklasse (reviewer ser ændring + rådata; typisk "internal")
 * @param {number} [options.maxTokens]
 */
export function createReviewerProvider({ complete, providerName, model = null, agentRef = null, dataClass = "internal", maxTokens = 2048 } = {}) {
  if (typeof complete !== "function") throw new Error("createReviewerProvider kræver en complete()-funktion (gateway-klienten)");
  if (!providerName) throw new Error("createReviewerProvider kræver et providerName (den leverandør routen peger på)");

  async function review({ change, rawData }) {
    const messages = [
      { role: "system", content: "Du er en adversariel reviewer. Se kun ændringen og rådata — ikke forfatterens begrundelse. Svar med JSON {verdict, findings}." },
      { role: "user", content: `Ændring:\n${typeof change === "string" ? change : JSON.stringify(change)}\n\nRådata:\n${typeof rawData === "string" ? rawData : JSON.stringify(rawData)}` },
    ];
    const result = await complete({ agentRef, model, messages, maxTokens, dataClass });
    let parsed = {};
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = { verdict: "flag", findings: [result.text].filter(Boolean) };
    }
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    return {
      verdict: parsed.verdict ?? "flag",
      findings,
      tokens: result.tokens,
      costEur: result.costEur,
      provider: providerName,
    };
  }

  return { providerName, review };
}

export { createGatewayAccounting };
