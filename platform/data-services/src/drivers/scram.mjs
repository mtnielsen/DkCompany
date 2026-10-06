/**
 * DKC-056 — SCRAM-SHA-256 til PostgreSQL-autentisering.
 *
 * Implementeret efter RFC 5802/7677 og PostgreSQLs SASL-profil. Bruges både af
 * driveren (klient) og af test-dobbeltens server, så begge sider taler samme
 * protokol og beviser hinandens nøgleafledning.
 *
 * Hemmeligheden forlader aldrig processen og logges aldrig.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

/** Escape brugernavn i SASL-navnet (RFC 5802 §5.1). */
export function saslName(name) {
  return String(name).replace(/=/g, "=3D").replace(/,/g, "=2C");
}

/** Kryptografisk nonce til SCRAM. */
export function generateNonce() {
  return randomBytes(18).toString("base64");
}

/** Klientens første besked: gs2-header 'n,,' + 'n=<bruger>,r=<nonce>'. */
export function clientFirst(user, clientNonce = generateNonce()) {
  const clientFirstBare = `n=${saslName(user)},r=${clientNonce}`;
  return { clientFirstBare, clientFirst: `n,,${clientFirstBare}`, clientNonce };
}

/** Serverens første besked. Returnerer også de værdier serveren skal huske. */
export function serverFirst(clientNonce, { salt = randomBytes(16), iterations = 4096 } = {}) {
  const combinedNonce = `${clientNonce}${generateNonce()}`;
  const value = `r=${combinedNonce},s=${salt.toString("base64")},i=${iterations}`;
  return { serverFirst: value, combinedNonce, salt, iterations };
}

/** Parse SCRAM-attributter (r, s, i, p, v, c, n). */
export function parseAttributes(value) {
  const out = {};
  for (const part of String(value).split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return out;
}

/** Afled nøgler og signaturer fra adgangskoden. */
export function deriveKeys(password, salt, iterations, authMessage) {
  const saltedPassword = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
  const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
  const serverSignature = createHmac("sha256", serverKey).update(authMessage).digest();
  return { clientKey, storedKey, clientSignature, serverSignature };
}

/** Klientens sidste besked med beviset. */
export function clientFinal(password, clientFirstBare, serverFirstMessage) {
  const attrs = parseAttributes(serverFirstMessage);
  const withoutProof = `c=biws,r=${attrs.r}`;
  const authMessage = `${clientFirstBare},${serverFirstMessage},${withoutProof}`;
  const { clientKey, clientSignature, serverSignature } = deriveKeys(password, Buffer.from(attrs.s, "base64"), Number(attrs.i), authMessage);
  const proof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < clientKey.length; i += 1) proof[i] = clientKey[i] ^ clientSignature[i];
  return { clientFinal: `${withoutProof},p=${proof.toString("base64")}`, serverSignature, authMessage };
}

/** Serverens verifikation af klientens bevis. */
export function verifyClientProof(password, salt, iterations, authMessage, proofBase64) {
  const { storedKey, clientSignature } = deriveKeys(password, salt, iterations, authMessage);
  const proof = Buffer.from(proofBase64, "base64");
  const clientKey = Buffer.alloc(proof.length);
  for (let i = 0; i < proof.length; i += 1) clientKey[i] = proof[i] ^ clientSignature[i];
  const recovered = createHash("sha256").update(clientKey).digest();
  return constantTimeEqual(recovered, storedKey);
}

export function constantTimeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
