/**
 * DKC-007 — deterministisk digest til at binde input, PDP-svar og evidens.
 *
 * Kanoniseringen er identisk med PDP'ens (`policy/pdp/src/crypto.mjs`), så
 * `digestOf(input)` i runtimen giver samme værdi som `decision.inputSha256`.
 * Det er den binding, der afgør om en PDP-beslutning faktisk gælder det input,
 * runtimen sendte — og ikke bare et svar der ligner.
 */
import { createHash } from "node:crypto";

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function digestOf(obj) {
  return sha256Hex(canonicalize(obj));
}
