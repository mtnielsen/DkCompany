import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, digestOfBytes, digestOfCanonical, isPlaceholderSha256, parseImageRef, assertPinnedDigest } from "../src/digest.mjs";
import { SupplyChainError } from "../src/errors.mjs";

const REAL = digestOfBytes("dkc-014-real-artifact");

test("canonicalize er rækkefølge-uafhængig", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
});

test("digestOfCanonical er deterministisk", () => {
  assert.equal(digestOfCanonical({ a: 1, b: [2, 3] }), digestOfCanonical({ b: [2, 3], a: 1 }));
});

test("pladsholder-digests afvises selv om de er 64 hex-tegn", () => {
  assert.equal(isPlaceholderSha256("a".repeat(64)), true);
  assert.equal(isPlaceholderSha256("0123456789abcdef".repeat(4)), true);
  assert.equal(isPlaceholderSha256("deadbeef" + "0".repeat(56)), true);
  assert.equal(isPlaceholderSha256("not-hex"), true);
  assert.equal(isPlaceholderSha256(REAL), false);
});

test("parseImageRef skelner repository, tag og digest", () => {
  const parsed = parseImageRef(`ghcr.io/example/pdp:1.2.3@sha256:${REAL}`);
  assert.equal(parsed.repository, "ghcr.io/example/pdp");
  assert.equal(parsed.tag, "1.2.3");
  assert.equal(parsed.digest, REAL);
  assert.equal(parsed.pinned, true);
});

test("assertPinnedDigest afviser :latest og pladsholdere", () => {
  assert.throws(() => assertPinnedDigest("ghcr.io/example/pdp:latest"), (err) => err instanceof SupplyChainError && err.code === "UNPINNED_IMAGE");
  assert.throws(() => assertPinnedDigest(`ghcr.io/example/pdp@sha256:${"a".repeat(64)}`), (err) => err instanceof SupplyChainError && err.code === "PLACEHOLDER_DIGEST");
  assert.equal(assertPinnedDigest(`ghcr.io/example/pdp@sha256:${REAL}`).digest, REAL);
});
