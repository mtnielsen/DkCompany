/**
 * DKC-016 — autentificeret kryptering af backupkomponenter.
 *
 * Hver komponent (database, objekter, konfiguration) krypteres separat med
 * AES-256-GCM. GCM giver både fortrolighed og integritet: en ændret
 * chiffertekst afvises ved dekryptering, så en muteret backup ikke kan indlæses
 * som gyldig. AAD'en binder chifferteksten til backup-id, komponenttype og navn,
 * så en komponent ikke kan byttes om med en anden.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export class CryptoError extends Error {
  constructor(message, code = "crypto_error") {
    super(message);
    this.name = "CryptoError";
    this.code = code;
  }
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

/** Accepter en 32-byte buffer eller en 64-tegns hex-streng som nøgle. */
export function toKeyBytes(key) {
  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) throw new CryptoError("backup-nøglen skal være præcis 32 byte", "bad_key");
    return key;
  }
  if (typeof key === "string" && /^[a-f0-9]{64}$/i.test(key.trim())) {
    return Buffer.from(key.trim(), "hex");
  }
  throw new CryptoError("backup-nøglen skal være 32 byte eller 64 hex-tegn", "bad_key");
}

export function encryptComponent(plaintext, key, { aad = "" } = {}) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", toKeyBytes(key), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") };
}

export function decryptComponent({ ciphertext, iv, authTag }, key, { aad = "" } = {}) {
  const decipher = createDecipheriv("aes-256-gcm", toKeyBytes(key), Buffer.from(iv, "hex"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new CryptoError(`dekryptering fejlede (nøgle, AAD eller chiffertekst passer ikke): ${err.message}`, "auth_failed");
  }
}

export function constantTimeEqualHex(a, b) {
  const left = Buffer.from(String(a ?? ""), "hex");
  const right = Buffer.from(String(b ?? ""), "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
