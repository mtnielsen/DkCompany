/**
 * DKC-023 — fail-closed PDP-klient for adaptere.
 *
 * Adaptere har brug for den samme kontrakt mod den centrale PDP, uanset om de
 * kalder den over HTTP eller får en in-process beslutningsfunktion i test. Denne
 * klient har én regel: hvis governance ikke kan nås, kastes
 * `GovernanceUnavailableError`, og handlingen udføres ikke. Der findes ingen
 * `failMode: "open"`.
 */
import { GovernanceUnavailableError } from "./errors.mjs";

export { GovernanceUnavailableError };

/**
 * Klient mod en central PDP over HTTP-JSON.
 */
export function createPdpClient({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 2000 } = {}) {
  if (!endpoint) throw new Error("createPdpClient kræver en endpoint");
  return {
    kind: "http-pdp",
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
        throw new GovernanceUnavailableError(`PDP utilgængelig: ${err.message}`, { cause: err });
      } finally {
        clearTimeout(timer);
      }
      if (!result || typeof result.decision !== "string") {
        throw new GovernanceUnavailableError("PDP svarede uden beslutning");
      }
      return result;
    },
  };
}

/**
 * Wrap en in-process beslutningsfunktion (PDP'en i `policy/pdp`) eller et objekt
 * med `decide`. Fejl oversættes til governance-utilgængelighed, så en nedbrudt
 * evaluator aldrig bliver et stiltiende "allow".
 */
export function createInProcessPdp(decideOrObject) {
  const decide = typeof decideOrObject === "function" ? decideOrObject : decideOrObject?.decide?.bind(decideOrObject);
  if (!decide) throw new Error("createInProcessPdp kræver en decide-funktion");
  return {
    kind: "in-process-pdp",
    async decide(input) {
      try {
        const result = await decide(input);
        if (!result || typeof result.decision !== "string") throw new Error("PDP svarede uden beslutning");
        return result;
      } catch (err) {
        if (err instanceof GovernanceUnavailableError) throw err;
        throw new GovernanceUnavailableError(`PDP fejlede: ${err.message}`, { cause: err });
      }
    },
  };
}
