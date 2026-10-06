import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSigningKey, signBundle, verifyBundleSignature, digestOf, canonicalize } from "../src/crypto.mjs";

const bundle = {
  apiVersion: "contracts.platform/v1alpha1",
  kind: "PolicyBundle",
  metadata: { name: "test", version: "1.0.0", createdAt: "2025-09-01T00:00:00Z", description: "test" },
  default: "deny",
  policies: [{ id: "x.allow", priority: 1, effect: "allow", when: { field: "action.verb", eq: "health" } }],
};

test("Ed25519 sign/verify roundtrip", () => {
  const key = generateSigningKey();
  const trusted = { keys: { k1: { publicKey: key.publicKey } } };
  const sig = signBundle(bundle, { privateKey: key.privateKey, keyId: "k1" });
  const result = verifyBundleSignature(bundle, sig, trusted);
  assert.equal(result.ok, true);
  assert.equal(result.digest, digestOf(bundle));
});

test("ændret indhold giver digest-mismatch", () => {
  const key = generateSigningKey();
  const trusted = { keys: { k1: { publicKey: key.publicKey } } };
  const sig = signBundle(bundle, { privateKey: key.privateKey, keyId: "k1" });
  const tampered = structuredClone(bundle);
  tampered.default = "allow";
  const result = verifyBundleSignature(tampered, sig, trusted);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("digest")));
});

test("uverificerbar signatur afvises", () => {
  const key = generateSigningKey();
  const other = generateSigningKey();
  const trusted = { keys: { k1: { publicKey: other.publicKey } } };
  const sig = signBundle(bundle, { privateKey: key.privateKey, keyId: "k1" });
  const result = verifyBundleSignature(bundle, sig, trusted);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("matcher ikke den betroede")));
});

test("ukendt keyId afvises", () => {
  const key = generateSigningKey();
  const sig = signBundle(bundle, { privateKey: key.privateKey, keyId: "unknown" });
  const result = verifyBundleSignature(bundle, sig, { keys: {} });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("ikke betroet")));
});

test("canonicalize er nøgle-uafhængig", () => {
  assert.equal(canonicalize({ b: 1, a: [2, 3] }), canonicalize({ a: [2, 3], b: 1 }));
  assert.equal(canonicalize({ a: 1 }), '{"a":1}');
});
