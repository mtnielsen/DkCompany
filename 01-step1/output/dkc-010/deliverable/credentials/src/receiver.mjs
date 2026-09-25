/**
 * DKC-010 — receiver-vagt.
 *
 * Modtageren (executor-tjenesten) må ikke stole på at kalderen har fulgt sine
 * egne regler. Før en handling udføres, verificeres det medbragte credential mod
 * modtagerens audience og den konkrete handling. Et afvist credential giver
 * `CredentialRejected` og ingen eksekvering.
 */
import { createCredentialVerifier } from "./verifier.mjs";

export class CredentialRejected extends Error {
  constructor(reasons, claims = null) {
    super(`credential afvist: ${reasons.join("; ")}`);
    this.name = "CredentialRejected";
    this.code = "CREDENTIAL_REJECTED";
    this.reasons = reasons;
    this.claims = claims;
  }
}

export function createExecutorGuard({ verifier, audience, clock = () => Date.now() } = {}) {
  if (!verifier) throw new Error("createExecutorGuard kræver en verifier");
  if (!audience) throw new Error("createExecutorGuard kræver en audience");

  function guard(executor) {
    if (typeof executor !== "function") throw new Error("guard kræver en executor-funktion");
    return async function guarded(input = {}) {
      const { credential, ...action } = input;
      const token = typeof credential === "string" ? credential : credential?.token ?? null;
      const check = verifier.verify(token, {
        audience,
        verb: action.verb,
        resource: action.target,
        tenantId: action.tenantId,
        environment: action.environment,
      });
      if (!check.ok) throw new CredentialRejected(check.reasons, check.claims);
      return executor({ ...action, credential, credentialClaims: check.claims });
    };
  }

  function guardAll(executors = {}) {
    return Object.fromEntries(Object.entries(executors).map(([verb, fn]) => [verb, guard(fn)]));
  }

  return { guard, guardAll, audience };
}

export { createCredentialVerifier };
