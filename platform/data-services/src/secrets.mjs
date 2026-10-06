/**
 * DKC-056 — secretreferencer.
 *
 * En connector indeholder aldrig en hemmelighed, kun en reference på formen
 * `<provider>:<sti>` (vault, k8s, env, file, kms). Opløsningen sker gennem en
 * injiceret resolver. Den opløste værdi forlader aldrig funktionskaldet og
 * optræder aldrig i revisionssporet.
 */
import { SecretError } from "./errors.mjs";

const REF_RE = /^(vault|k8s|env|file|kms):[A-Za-z0-9_./#:-]{3,200}$/;

export function isSecretRef(ref) {
  return typeof ref === "string" && REF_RE.test(ref);
}

export function assertSecretRef(ref) {
  if (!isSecretRef(ref)) throw new SecretError(`ugyldig secretreference '${ref}' (forventer <provider>:<sti>)`);
  return ref;
}

/** Byg en resolver over en vilkårlig `resolve(ref)`-funktion. */
export function createSecretResolver({ resolve } = {}) {
  if (typeof resolve !== "function") throw new SecretError("createSecretResolver kræver en resolve-funktion");
  return async function secretResolver(ref) {
    assertSecretRef(ref);
    let value;
    try {
      value = await resolve(ref);
    } catch (err) {
      throw new SecretError(`kunne ikke opløse '${ref}': ${err.message}`, { cause: err });
    }
    if (value === undefined || value === null || value === "") {
      throw new SecretError(`hemmeligheden '${ref}' er ikke konfigureret`);
    }
    return value;
  };
}

/** In-memory resolver til tests og lokal udvikling. */
export function inMemorySecretResolver(map = {}) {
  return createSecretResolver({ resolve: async (ref) => map[ref] });
}

/** Miljøvariabel-resolver: `env:SECRET_NAME` læses fra process.env. */
export function envSecretResolver(env = process.env) {
  return createSecretResolver({ resolve: async (ref) => env[ref.slice("env:".length)] });
}
