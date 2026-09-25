/**
 * DKC-012 — model-egress-grænse.
 *
 * Kun modelgatewayen må føre samtaler med en modelleverandør. En
 * agent-workload har hverken leverandørnøgler eller netværksvej: den kan kun
 * kalde gatewayen. Denne modul er den ene, delte regel for *hvem* der må
 * kontakte *hvilke* leverandørværter.
 *
 * Reglen håndhæves på tre niveauer, så et enkelt fejltrin ikke åbner egress:
 *   1. leverandøradapteren kalder `assertModelEgressAllowed` før hvert kald,
 *   2. gatewayen wrapper sin `fetch` med `createGuardedFetch`, og
 *   3. GitOps-materialet (NetworkPolicy) afviser egress fra alle andre pods.
 *
 * Hostlisten er kanonisk og bruges både af adapteren og af GitOps-kontrollen
 * (`gitops/src/egress.mjs`), så en ny leverandør ikke kan snige sig ind i
 * koden uden også at være i netværkspolitikken.
 */

/** Leverandørværter gatewayen må kontakte. */
export const DEFAULT_PROVIDER_HOSTS = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
];

/** Den eneste principal-type der må føre model-egress. */
export const GATEWAY_EGRESS_PRINCIPAL = "gateway";

export class ModelEgressBlocked extends Error {
  constructor(message, { host = null, caller = null, reason = "forbidden-caller" } = {}) {
    super(message);
    this.name = "ModelEgressBlocked";
    this.host = host;
    this.caller = caller;
    this.reason = reason;
  }
}

function callerKind(caller) {
  if (!caller) return null;
  if (typeof caller === "string") return caller;
  return caller.kind ?? caller.type ?? null;
}

function callerId(caller) {
  if (!caller || typeof caller === "string") return null;
  return caller.id ?? caller.spiffeId ?? null;
}

/**
 * Byg den delte egress-vagt. `gatewayPrincipals` er de principal-ID'er der
 * betragtes som gatewayen (fx gatewayens SPIFFE-ID). En kalder hvis `kind` er
 * `gateway` accepteres altid; en workload afvises uanset ID.
 */
export function createEgressGuard({ allowedHosts = DEFAULT_PROVIDER_HOSTS, gatewayPrincipals = [] } = {}) {
  const hosts = new Set(allowedHosts.map((h) => String(h).toLowerCase()));
  const principals = new Set(gatewayPrincipals.filter(Boolean));

  function hostOf(url) {
    try {
      return new URL(String(url)).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  return {
    allowedHosts: [...hosts],
    gatewayPrincipals: [...principals],
    /** Kaster hvis kalderen ikke er gatewayen, eller værten ikke er en leverandør. */
    assertAllowed({ url, caller } = {}) {
      const host = hostOf(url);
      const kind = callerKind(caller);
      const id = callerId(caller);
      const isGateway = kind === GATEWAY_EGRESS_PRINCIPAL || (id && principals.has(id));
      if (!isGateway) {
        throw new ModelEgressBlocked(`direkte model-egress er forbudt for '${kind ?? "ukendt"}' — alene modelgatewayen må nå en leverandør`, {
          host,
          caller: kind ?? id,
          reason: "forbidden-caller",
        });
      }
      if (!host || !hosts.has(host)) {
        throw new ModelEgressBlocked(`leverandørværten '${host ?? "?"}' er ikke på egress-allowlisten`, { host, caller: kind ?? id, reason: "host-not-allowed" });
      }
      return true;
    },
    isAllowed(url, caller) {
      try {
        this.assertAllowed({ url, caller });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Wrap en fetch, så hvert kald kontrolleres mod egress-vagten. Kalderen er
 * bundet på forhånd (fx `{ kind: "gateway" }`), så en workload ikke kan låne
 * gatewayens fetch uden at være gateway.
 */
export function createGuardedFetch({ fetchImpl = globalThis.fetch, guard, caller = { kind: GATEWAY_EGRESS_PRINCIPAL } } = {}) {
  if (!guard) throw new Error("createGuardedFetch kræver en egress-vagt");
  return async function guardedFetch(url, init) {
    guard.assertAllowed({ url, caller });
    return fetchImpl(url, init);
  };
}
