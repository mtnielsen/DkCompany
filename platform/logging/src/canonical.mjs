/**
 * DKC-049 — kanonisk serialisering og digest.
 *
 * Hash-kæden, arkivdigest og approval-binding skal være deterministiske på
 * tværs af processer og servere. Derfor sorteres nøgler, og JSON bygges i
 * hånden i stedet for at stole på `JSON.stringify`-rækkefølgen.
 */
import { createHash } from "node:crypto";

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}
