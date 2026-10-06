/**
 * Lokal testleverandør. I produktion injectes en rigtig leverandør bag
 * gatewayen; agent-runtimen ser den aldrig.
 */
export function createEchoProvider({ costPerTokenEur = 0.00001 } = {}) {
  return {
    async complete({ messages, model }) {
      const prompt = Array.isArray(messages) ? messages.map((m) => m.content).join("\n") : "";
      const text = `echo(${model}): ${prompt}`;
      const tokens = Math.max(1, Math.ceil((prompt.length + text.length) / 4));
      return { text, tokens, costEur: tokens * costPerTokenEur };
    },
  };
}

export function createFailingProvider({ message = "provider unavailable" } = {}) {
  return {
    async complete() {
      throw new Error(message);
    },
  };
}
