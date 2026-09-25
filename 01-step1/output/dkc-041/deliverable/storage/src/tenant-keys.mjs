/**
 * DKC-041 — kundeafgrænsede lager-nøgler.
 *
 * Krypteringsnøglen for en tenants data udledes deterministisk med HKDF-SHA256
 * fra en master-nøgle der lever i et **eksternt** nøglemagasin (KMS), ikke i
 * selve lageret (`storeContainsKey: false`). Hver tenant — og hver dataklasse —
 * får sin egen afledte nøgle, så en kompromitteret nøgle for én kunde ikke
 * åbner en anden kundes data, og så en cache-nøgle ikke kan dekryptere
 * autoritative data.
 *
 * Master-nøglen forlader aldrig processen gennem manifestet; kun den afledte
 * nøgle bruges til AES-256-GCM. En rigtig KMS/HSM-adapter skal opfylde samme
 * grænseflade som `createTenantKeyRing`.
 */
import { hkdfSync, randomBytes } from "node:crypto";
import { toKeyBytes } from "../../backup/src/crypto.mjs";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

export class StorageKeyError extends Error {
  constructor(message, code = "storage_key_error") {
    super(message);
    this.name = "StorageKeyError";
    this.code = code;
  }
}

/**
 * @param {object} options
 * @param {Buffer|string} options.masterKey  32 byte eller 64 hex-tegn, lever i KMS.
 * @param {string} [options.keyId]
 * @param {string} [options.storeRoot]       Bevidst ikke brugt: nøglen ligger ikke i lageret.
 */
export function createTenantKeyRing({ masterKey, keyId = "storage-master" } = {}) {
  if (!masterKey) throw new StorageKeyError("createTenantKeyRing kræver en master-nøgle fra KMS", "missing_master_key");
  const ikm = toKeyBytes(masterKey);
  const salt = Buffer.from(`platform/storage/${keyId}`, "utf8");

  return {
    kind: "tenant-key-ring",
    keyId,
    storeContainsKey: false,
    /** Afled en 32-byte nøgle for tenant + dataklasse. */
    keyFor(tenantIdRaw, classification = "authoritative") {
      const tenantId = normalizeTenantId(tenantIdRaw);
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(classification ?? ""))) {
        throw new StorageKeyError(`ugyldig dataklasse '${classification}'`, "bad_classification");
      }
      const info = Buffer.from(`tenant/${tenantId}/class/${classification}`, "utf8");
      return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
    },
  };
}

/** Test-/dev-provider der holder master-nøglen i hukommelsen uden for lageret. */
export function createMemoryMasterKey({ bytes = 32 } = {}) {
  return randomBytes(bytes).toString("hex");
}

/** Hjælper til tests: en deterministisk master-nøgle (ikke til produktion). */
export function deriveTestKeyRing(seed = "dkc-041-test-master") {
  const ikm = Buffer.from(seed.padEnd(32, "0").slice(0, 32), "utf8");
  return { masterKey: ikm.toString("hex"), keyId: "storage-test" };
}
