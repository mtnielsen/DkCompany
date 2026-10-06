/**
 * DKC-043 — domæneafgrænsede dedup-nøgler.
 *
 * Dedup sker aldrig på tværs af kunder. Hvert dedup-domæne (tenant +
 * krypteringsdomæne + retentionklasse + datakategori) får sin egen nøgle,
 * udledt med HKDF-SHA256 fra en master-nøgle i et eksternt nøglemagasin.
 * Dermed giver identisk klartekst i to domæner forskellige chunk-adresser og
 * forskellige chiffertekster: en tenant kan ikke udlede en anden tenants
 * indhold ved at sammenligne chunks, og en kompromitteret domænenøgle åbner
 * ikke andre domæner.
 *
 * Nøglen ligger ikke i dedup-lageret; kun en `keyId` optræder i metadata.
 */
import { hkdfSync, randomBytes } from "node:crypto";
import { toKeyBytes } from "../../backup/src/crypto.mjs";

export class DedupKeyError extends Error {
  constructor(message, code = "dedup_key_error") {
    super(message);
    this.name = "DedupKeyError";
    this.code = code;
  }
}

export function createDedupKeyRing({ masterKey, keyId = "dedup-master" } = {}) {
  if (!masterKey) throw new DedupKeyError("createDedupKeyRing kræver en master-nøgle fra KMS", "missing_master_key");
  const ikm = toKeyBytes(masterKey);
  const salt = Buffer.from(`platform/dedup/${keyId}`, "utf8");

  return {
    kind: "dedup-key-ring",
    keyId,
    storeContainsKey: false,
    /** Afled en 32-byte nøgle for et dedup-domænes kanoniske id. */
    keyFor(domainId) {
      if (typeof domainId !== "string" || domainId.trim() === "") {
        throw new DedupKeyError("keyFor kræver et domæne-id", "bad_domain");
      }
      return Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from(`domain/${domainId}`, "utf8"), 32));
    },
  };
}

/** Test-/dev-provider der holder master-nøglen i hukommelsen uden for lageret. */
export function createMemoryMasterKey({ bytes = 32 } = {}) {
  return randomBytes(bytes).toString("hex");
}

/** Deterministisk testnøgle (må ikke bruges i produktion). */
export function deriveTestKeyRing(seed = "dkc-043-test-master") {
  const ikm = Buffer.from(seed.padEnd(32, "0").slice(0, 32), "utf8");
  return { masterKey: ikm.toString("hex"), keyId: "dedup-test" };
}
