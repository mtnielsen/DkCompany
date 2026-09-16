import { createHash, generateKeyPairSync, createPublicKey, createPrivateKey, sign as edSign, verify as edVerify } from "node:crypto";

/** Deterministisk JSON: sorterede nøgler, ingen whitespace. Grundlaget for digest. */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function digestOf(obj) {
  return sha256Hex(canonicalize(obj));
}

/** Generér et Ed25519-nøglepar. Returnerer base64-kodede DER-nøgler. */
export function generateSigningKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

/** Signér en bundle med en Ed25519-privatnøgle. Returnerer en detached signatur. */
export function signBundle(bundle, { privateKey, keyId }) {
  const digestSha256 = digestOf(bundle);
  const key = createPrivateKey({ key: Buffer.from(privateKey, "base64"), format: "der", type: "pkcs8" });
  const signature = edSign(null, Buffer.from(canonicalize(bundle)), key).toString("base64");
  return {
    algorithm: "Ed25519",
    keyId,
    publicKey: createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64"),
    digestSha256,
    signature,
    signedAt: new Date().toISOString(),
  };
}

/**
 * Verificér en bundle-signatur mod et sæt betroede nøgler.
 * `trustedKeys` har formen { keys: { "<keyId>": { publicKey, owner, ... } } }.
 */
export function verifyBundleSignature(bundle, sig, trustedKeys) {
  const errors = [];
  const digest = digestOf(bundle);
  if (sig.algorithm !== "Ed25519") errors.push(`ukendt algoritme '${sig.algorithm}'`);
  if (sig.digestSha256 !== digest) errors.push("digest matcher ikke bundle-indholdet");
  const trusted = trustedKeys?.keys?.[sig.keyId];
  if (!trusted) errors.push(`keyId '${sig.keyId}' er ikke betroet`);
  else if (trusted.publicKey !== sig.publicKey) errors.push("signaturens nøgle matcher ikke den betroede nøgle");

  if (errors.length) return { ok: false, digest, errors };

  let ok = false;
  try {
    const key = createPublicKey({ key: Buffer.from(trusted.publicKey, "base64"), format: "der", type: "spki" });
    ok = edVerify(null, Buffer.from(canonicalize(bundle)), key, Buffer.from(sig.signature, "base64"));
  } catch (err) {
    errors.push(`kunne ikke verificere: ${err.message}`);
  }
  if (!ok && errors.length === 0) errors.push("signaturen kan ikke verificeres");
  return { ok: errors.length === 0, digest, errors };
}
