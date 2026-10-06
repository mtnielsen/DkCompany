/**
 * DKC-012 — reel leverandøradapter bag gatewayen.
 *
 * Adapteren taler den OpenAI-kompatible `/chat/completions`-protokol over
 * rigtig HTTP (også streaming). Den er den eneste komponent der kender en
 * leverandørnøgle, og hvert kald passerer egress-vagten, så en agent-workload
 * ikke kan låne den.
 *
 * Adapteren understøtter:
 *   - serverstyret timeout (`timeoutMs`) og afbrydelse (`signal`),
 *   - streaming med token-for-token `onToken`,
 *   - afregning: den rapporterer faktisk `tokens`/`costEur` — også når et
 *     stream afbrydes midtvejs (delvist forbrug),
 *   - fail-safe fejltyper (`ProviderTimeoutError`, `ProviderCancelledError`,
 *     `ProviderError`) som gatewayen omsætter til korrekt bogføring.
 */
import { createEgressGuard, createGuardedFetch, GATEWAY_EGRESS_PRINCIPAL } from "../egress.mjs";

export class ProviderError extends Error {
  constructor(message, { status = 502, retryable = false, body = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
    this.body = body;
  }
}

export class ProviderTimeoutError extends Error {
  constructor(message, { partial = null } = {}) {
    super(message);
    this.name = "ProviderTimeoutError";
    this.partial = partial;
  }
}

export class ProviderCancelledError extends Error {
  constructor(message, { partial = null } = {}) {
    super(message);
    this.name = "ProviderCancelledError";
    this.partial = partial;
  }
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? "").length / 4));
}

function messagesToText(messages) {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m) => (typeof m === "string" ? m : `${m?.role ?? "user"}: ${m?.content ?? ""}`))
    .join("\n");
}

/**
 * @param {object} options
 * @param {string} options.baseUrl      fx https://api.openai.com/v1
 * @param {string} options.apiKey
 * @param {string} [options.providerName]
 * @param {number} [options.costPerTokenEur]
 * @param {number} [options.defaultTimeoutMs]
 * @param {Function} [options.fetchImpl]
 * @param {object} [options.egressGuard]
 * @param {string[]} [options.gatewayPrincipals]
 */
export function createOpenAiCompatibleProvider({
  baseUrl,
  apiKey,
  providerName = "openai-compatible",
  costPerTokenEur = 0.000002,
  defaultTimeoutMs = 30000,
  fetchImpl = globalThis.fetch,
  egressGuard = null,
  gatewayPrincipals = [],
} = {}) {
  if (!baseUrl) throw new Error("createOpenAiCompatibleProvider kræver en baseUrl");
  const guard = egressGuard ?? createEgressGuard({ gatewayPrincipals });
  const guardedFetch = createGuardedFetch({ fetchImpl, guard, caller: { kind: GATEWAY_EGRESS_PRINCIPAL } });
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;

  async function callProvider({ model, messages, maxTokens, timeoutMs, signal, onToken, stream }) {
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs ?? defaultTimeoutMs);
    const onExternalAbort = () => {
      cancelled = true;
      controller.abort();
    };
    if (signal) {
      if (signal.aborted) onExternalAbort();
      else signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };

    try {
      const res = await guardedFetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        let text = "";
        try {
          text = await res.text();
        } catch {
          text = "";
        }
        throw new ProviderError(`leverandøren svarede HTTP ${res.status}`, { status: res.status >= 500 ? 502 : res.status, retryable: res.status === 429 || res.status >= 500, body: text.slice(0, 500) });
      }

      if (!stream) {
        const payload = await res.json();
        const promptTokens = payload.usage?.prompt_tokens ?? estimateTokens(messagesToText(messages));
        const completionTokens = payload.usage?.completion_tokens ?? estimateTokens(payload.choices?.[0]?.message?.content);
        const tokens = payload.usage?.total_tokens ?? promptTokens + completionTokens;
        return {
          text: payload.choices?.[0]?.message?.content ?? "",
          tokens,
          promptTokens,
          completionTokens,
          costEur: tokens * costPerTokenEur,
          finishReason: payload.choices?.[0]?.finish_reason ?? "stop",
        };
      }

      return await readStream({ res, messages, maxTokens, costPerTokenEur, onToken, isAborted: () => controller.signal.aborted });
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (timedOut) {
        throw new ProviderTimeoutError(`leverandørkaldet overskred timeout på ${timeoutMs ?? defaultTimeoutMs} ms`, { partial: err.partial ?? null });
      }
      if (cancelled || controller.signal.aborted) {
        throw new ProviderCancelledError("leverandørkaldet blev afbrudt", { partial: err.partial ?? null });
      }
      throw new ProviderError(`leverandørkald fejlede: ${err.message}`, { retryable: true });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    }
  }

  return {
    kind: "openai-compatible",
    name: providerName,
    supportsStreaming: true,
    endpoint,
    egressGuard: guard,
    defaultCostPerTokenEur: costPerTokenEur,
    async complete({ model, messages = [], maxTokens, timeoutMs, signal, onToken, stream = false }) {
      return callProvider({ model, messages, maxTokens, timeoutMs, signal, onToken, stream });
    },
    async review({ change, rawData, model, maxTokens, timeoutMs, signal, onToken }) {
      const messages = [
        { role: "system", content: "Du er en adversariel reviewer. Se kun ændringen og rådata. Svar med JSON {verdict, findings}." },
        { role: "user", content: `Ændring:\n${typeof change === "string" ? change : JSON.stringify(change)}\n\nRådata:\n${typeof rawData === "string" ? rawData : JSON.stringify(rawData)}` },
      ];
      const result = await callProvider({ model, messages, maxTokens, timeoutMs, signal, onToken, stream: false });
      let parsed = {};
      try {
        parsed = JSON.parse(result.text);
      } catch {
        parsed = { verdict: "flag", findings: [result.text].filter(Boolean) };
      }
      return { ...parsed, tokens: result.tokens, costEur: result.costEur };
    },
  };
}

/**
 * Læs et SSE-stream. Returnerer faktisk forbrug, også hvis strømmen afbrydes
 * før `[DONE]`: det antal tokens der faktisk er modtaget, afregnes.
 */
async function readStream({ res, messages, maxTokens, costPerTokenEur, onToken, isAborted }) {
  const promptTokens = estimateTokens(messagesToText(messages));
  let text = "";
  let completionChars = 0;
  let usage = null;
  let finishReason = "stop";
  const decoder = new TextDecoder();
  let buffer = "";
  let aborted = false;

  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          finishReason = "stop";
          continue;
        }
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          text += delta;
          completionChars += delta.length;
          onToken?.(delta);
        }
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (chunk.usage) usage = chunk.usage;
      }
    }
  } catch (err) {
    aborted = true;
    const completionTokens = usage?.completion_tokens ?? estimateTokens(text || "x");
    const tokens = usage?.total_tokens ?? promptTokens + completionTokens;
    const partial = { text, tokens, promptTokens, completionTokens, costEur: tokens * costPerTokenEur, finishReason: "aborted", aborted: true };
    err.partial = partial;
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* streamen kan allerede være lukket */
    }
  }

  const completionTokens = usage?.completion_tokens ?? Math.max(1, Math.ceil(completionChars / 4));
  const tokens = usage?.total_tokens ?? promptTokens + completionTokens;
  return { text, tokens, promptTokens, completionTokens, costEur: tokens * costPerTokenEur, finishReason, aborted: aborted || isAborted() };
}
