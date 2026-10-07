/**
 * DKC-010 — nøglehåndtering og signerer-abstraktion.
 *
 * Rettigheder udstedes som signerede tokens (JWS/EdDSA). Signeringen sker i en
 * **signerer** der kun eksponerer `sign()` og den offentlige nøgle. Den private
 * nøgle forlader aldrig signereren:
 *
 *   - I produktion er signereren en cloud-KMS eller HashiCorp Vault
 *     Transit/secret-broker, hvor nøglen er ikke-eksporterbar og hver signatur
 *     er revideret. `createLocalSigner` nedenfor er den lokale udviklings-/
 *     testimplementering med præcis samme grænseflade.
 *   - Verifikationssiden modtager kun et JWKS (offentlige nøgler) og kan derfor
 *     ikke udstede rettigheder.
 *
 * Nøgler roteres ved at udstede et nyt `kid`; gamle nøgler kan fjernes fra
 * JWKS, hvorefter tokens signeret med dem afvises.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";

/** Generér et nyt Ed25519-nøglepar (kun til lokal signerer/tests). */
export function generateSigningKey({ kid = `k-${createHash("sha256").update(String(Date.now()) + Math.random()).digest("hex").slice(0, 12)}` } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { kid, alg: "EdDSA", publicKey, privateKey };
}

function toPublicJwk(publicKey, kid, alg = "EdDSA") {
  const jwk = publicKey.export({ format: "jwk" });
  return { kty: "OKP", crv: "Ed25519", x: jwk.x, kid, alg, use: "sig" };
}

/**
 * Lokal signerer. Grænsefladen (`kid`, `alg`, `sign`, `publicJwk`) er den samme
 * en KMS/secret-broker-adapter skal opfylde.
 */
export function createLocalSigner({ kid, keypair = generateSigningKey({ kid }) } = {}) {
  const id = kid ?? keypair.kid;
  return {
    kind: "local-signer",
    kid: id,
    alg: "EdDSA",
    sign(bytes) {
      return edSign(null, Buffer.from(bytes), keypair.privateKey);
    },
    publicJwk() {
      return toPublicJwk(keypair.publicKey, id, "EdDSA");
    },
  };
}

/** Byg en signerer ud fra en eksporteret privat JWK (fx fra en hemmelighedsbeholder i dev). */
export function signerFromPrivateJwk({ kid, jwk } = {}) {
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  const publicKey = createPublicKey(privateKey);
  return {
    kind: "local-signer",
    kid,
    alg: "EdDSA",
    sign(bytes) {
      return edSign(null, Buffer.from(bytes), privateKey);
    },
    publicJwk() {
      return toPublicJwk(publicKey, kid, "EdDSA");
    },
  };
}

/** Erstat en signerer med en KMS-adapter (samme kontrakt) — dokumenteret grænse. */
export function assertSigner(signer) {
  for (const method of ["sign", "publicJwk"]) {
    if (typeof signer?.[method] !== "function") throw new Error(`signereren mangler '${method}()'`);
  }
  if (!signer.kid) throw new Error("signereren mangler et kid");
  return signer;
}

/** Verificér en EdDSA-signatur mod en offentlig JWK. */
export function verifySignature({ jwk, bytes, signature } = {}) {
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  return edVerify(null, Buffer.from(bytes), publicKey, Buffer.from(signature));
}

export function signersToJwks(signers = []) {
  return { keys: signers.filter(Boolean).map((s) => s.publicJwk()) };
}

/** Slå en offentlig nøgle op på `kid`. Ukendt kid giver null (fail-closed). */
export function keyResolverFromJwks(jwks) {
  const keys = jwks?.keys ?? [];
  return (kid) => keys.find((k) => k.kid === kid) ?? null;
}
