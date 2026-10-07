/**
 * DKC-014 — digest- og image-referencer.
 *
 * Verifikationen må ikke nøjes med at tælle hex-tegn: `aaaa…` er 64 hex-tegn,
 * men kan ikke være en hash. Denne modul genbruger den kanoniske
 * pladsholder-detektion fra conformance (DKC-014) og tilføjer parsing af
 * image-referencer og deterministisk hashing af bytes og kanonisk JSON.
 *
 * En «pinned» image-referencer er `<repository>@sha256:<64 hex>`; en tag som
 * `:latest` er ikke en pin.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assert } from "./errors.mjs";
import { isPlaceholderHex, isPlaceholderSha256 } from "../../conformance/src/supply-chain.mjs";

export { isPlaceholderHex, isPlaceholderSha256 } from "../../conformance/src/supply-chain.mjs";

export const SHA256_HEX = /^[a-f0-9]{64}$/;
export const IMAGE_DIGEST = /@sha256:[a-f0-9]{64}$/;

/**
 * Parse en container-referencer på formen `[registry/]repo[:tag][@sha256:…]`.
 * Returnerer repository, tag, digest (uden `sha256:`) og om referencen er pinnet.
 */
export function parseImageRef(ref) {
  assert(typeof ref === "string" && ref.length > 0, "BAD_REF", `Ugyldig image-referencer: ${ref}`);
  const [base, digestPart] = ref.split("@");
  const digest = digestPart ? digestPart.replace(/^sha256:/, "") : null;
  const lastColon = base.lastIndexOf(":");
  const lastSlash = base.lastIndexOf("/");
  let repository = base;
  let tag = null;
  if (lastColon > lastSlash) {
    repository = base.slice(0, lastColon);
    tag = base.slice(lastColon + 1);
  }
  return {
    ref,
    repository,
    tag,
    digest,
    pinned: Boolean(digest) && SHA256_HEX.test(digest),
  };
}

/** Kaster en typet fejl hvis referencen ikke er pinnet på en rigtig digest. */
export function assertPinnedDigest(ref) {
  const parsed = parseImageRef(ref);
  assert(parsed.pinned, "UNPINNED_IMAGE", `Image '${ref}' er ikke pinnet på @sha256:<64 hex>`);
  assert(!isPlaceholderSha256(parsed.digest), "PLACEHOLDER_DIGEST", `Image '${ref}' bærer en pladsholder-digest`);
  return parsed;
}

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

export function digestOfBytes(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

export function digestOfFile(path, algorithm = "sha256") {
  return digestOfBytes(readFileSync(path), algorithm);
}

export function digestOfCanonical(value, algorithm = "sha256") {
  return digestOfBytes(Buffer.from(canonicalize(value), "utf8"), algorithm);
}

/** `sha256:<hex>` — den form manifestet og SBOM'en bruger. */
export function pinnedDigestOfBytes(bytes) {
  return `sha256:${digestOfBytes(bytes)}`;
}
