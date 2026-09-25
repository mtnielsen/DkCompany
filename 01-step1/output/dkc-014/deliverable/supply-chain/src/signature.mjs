/**
 * DKC-014 — rigtig signaturverifikation med `node:crypto`.
 *
 * Releaseartefakter signeres med Ed25519. Signaturen dækker et kanonisk payload
 * bestående af artefaktets navn, digest, SBOM-digest, proveniens-digest og
 * kilde-commit. Den private nøgle ligger aldrig i repoet; kun den offentlige
 * halvdel udgør trust anchor i `release/artifacts.json`.
 *
 * Testene genererer et ephemeralt nøglepar i hukommelsen, så intet privat
 * materiale committes.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { canonicalize } from "./digest.mjs";

export function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

export function keyIdOf(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** Det kanoniske payload en artefaktsignatur dækker. */
export function signaturePayload(artifact) {
  return Buffer.from(
    canonicalize({
      name: artifact.name,
      digest: artifact.digest ?? null,
      sbom: artifact.sbom?.sha256 ?? null,
      provenance: artifact.provenance?.sha256 ?? null,
      sourceCommit: artifact.sourceCommit ?? null,
    }),
    "utf8"
  );
}

export function signArtifact(privateKeyPem, artifact) {
  return signBytes(privateKeyPem, signaturePayload(artifact));
}

/** Signér vilkårlige bytes og returnér en Ed25519-signatur med nøgle-id. */
export function signBytes(privateKeyPem, bytes) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const value = cryptoSign(null, bytes, privateKey).toString("base64");
  return { algorithm: "ed25519", keyId: keyIdOf(publicKeyPem), value };
}

/** Verificér en Ed25519-signatur over vilkårlige bytes mod en offentlig nøgle. */
export function verifyBytes(publicKeyPem, bytes, signature) {
  if (!signature || signature.algorithm !== "ed25519") {
    return { ok: false, reason: "signaturen bruger ikke en understøttet algoritme" };
  }
  try {
    if (signature.keyId !== keyIdOf(publicKeyPem)) {
      return { ok: false, reason: `signaturens nøgle-id '${signature.keyId}' matcher ikke den betroede nøgle` };
    }
    const ok = cryptoVerify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(signature.value, "base64"));
    return { ok, reason: ok ? null : "signaturen matcher ikke payloaden" };
  } catch (err) {
    return { ok: false, reason: `signaturverifikation fejlede: ${err.message}` };
  }
}

export function verifyArtifact(publicKeyPem, artifact, signature) {
  if (!signature) return { ok: false, reason: "artefaktet er ikke signeret" };
  return verifyBytes(publicKeyPem, signaturePayload(artifact), signature);
}

/** Trust anchor fra artefaktmanifestet: keyId → offentlig nøgle-PEM. */
export function trustAnchorMap(manifest) {
  const map = new Map();
  for (const key of manifest?.trustAnchor?.keys ?? []) map.set(key.keyId, key.publicKeyPem);
  return map;
}
