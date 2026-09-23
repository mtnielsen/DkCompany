/** Governance kan ikke nås. I fail-closed betyder det: handlingen udføres ikke. */
export class GovernanceUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "GovernanceUnavailable";
  }
}

/**
 * Klient mod central PDP. Adapteren har sin egen tynde kopi, så den kan
 * deployes uafhængigt af referencemodulet. Kontrakten er den samme.
 */
export function createPdpClient({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 2000, failMode = "closed" }) {
  if (failMode !== "closed") throw new Error("kun failMode 'closed' er tilladt");
  return {
    endpoint,
    async decide(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let result;
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`PDP svarede HTTP ${res.status}`);
        const payload = await res.json();
        result = payload.result ?? payload;
      } catch (err) {
        throw new GovernanceUnavailable(`PDP utilgængelig: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
      if (!result || typeof result.decision !== "string") throw new GovernanceUnavailable("PDP svarede uden beslutning");
      return result;
    },
  };
}
