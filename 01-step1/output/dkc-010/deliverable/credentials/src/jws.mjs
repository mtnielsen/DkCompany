/**
 * DKC-010 — kompakt JWS (EdDSA) til kortlivede rettigheder.
 *
 * Formatet er `base64url(header).base64url(payload).base64url(signatur)`.
 * Det er bevidst en minimal, fuldt verificerbar JWS — ikke et UUID og ikke et
 * uigennemsigtigt token. Verifikationen er fail-closed: ukendt algoritme,
 * ukendt nøgle, ugyldig signatur, forkert `typ` eller udløbet `exp` afvises.
 */
import { verifySignature } from "./keys.mjs";

export function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlJson(value) {
  return base64url(JSON.stringify(value));
}

export function fromBase64url(value) {
  const s = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64");
}

const REQUIRED_ALG = "EdDSA";

/** Signér et sæt claims. Returnerer den kompakte JWS som streng. */
export function signJws({ signer, claims, typ = "JWT" } = {}) {
  if (!signer?.sign || !signer?.kid) throw new Error("signJws kræver en signerer med kid");
  const header = { alg: signer.alg ?? REQUIRED_ALG, kid: signer.kid, typ };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(claims)}`;
  const signature = signer.sign(Buffer.from(signingInput));
  return `${signingInput}.${base64url(signature)}`;
}

/** Dekod uden at verificere (bruges til fejlfinding og til at læse header før nøglevalg). */
export function decodeJws(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) throw new Error("ugyldigt JWS-format");
  const [headerPart, payloadPart, signaturePart] = parts;
  return {
    header: JSON.parse(fromBase64url(headerPart).toString("utf8")),
    claims: JSON.parse(fromBase64url(payloadPart).toString("utf8")),
    signingInput: `${headerPart}.${payloadPart}`,
    signature: fromBase64url(signaturePart),
  };
}

/**
 * Verificér signatur og tidsclaims. Returnerer `{ ok, header, claims, reasons }`.
 * `resolveKey(kid)` skal returnere en offentlig JWK eller null.
 */
export function verifyJws({ token, resolveKey, clock = () => Date.now(), maxSkewSeconds = 5, nowSeconds = null } = {}) {
  const reasons = [];
  let decoded;
  try {
    decoded = decodeJws(token);
  } catch (err) {
    return { ok: false, reasons: [`ugyldigt token: ${err.message}`], header: null, claims: null };
  }
  const { header, claims, signingInput, signature } = decoded;

  if (header.alg !== REQUIRED_ALG) reasons.push(`uventet alg '${header.alg}' (kun ${REQUIRED_ALG})`);
  if (header.typ !== "JWT") reasons.push(`uventet typ '${header.typ}'`);

  const jwk = resolveKey ? resolveKey(header.kid) : null;
  if (!jwk) {
    reasons.push(`ukendt signeringsnøgle '${header.kid}'`);
  } else if (!verifySignature({ jwk, bytes: Buffer.from(signingInput), signature })) {
    reasons.push("signaturen matcher ikke");
  }

  const now = nowSeconds ?? Math.floor(clock() / 1000);
  const skew = Number(maxSkewSeconds) || 0;
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) reasons.push("exp mangler");
  else if (now > claims.exp + skew) reasons.push("tokenet er udløbet");
  if (typeof claims.nbf === "number" && now < claims.nbf - skew) reasons.push("tokenet er ikke gyldigt endnu");
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat)) reasons.push("iat mangler");

  return { ok: reasons.length === 0, header, claims, reasons };
}
