import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, keyIdOf, signArtifact, verifyArtifact } from "../src/signature.mjs";
import { buildProvenance, signProvenance, verifyProvenance } from "../src/provenance.mjs";

const artifact = { name: "ghcr.io/example/pdp", digest: "1".repeat(64), sbom: { sha256: "2".repeat(64) }, provenance: null, sourceCommit: "a".repeat(40) };

test("Ed25519-signatur runder korrekt og afviser ændret digest", () => {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  const signature = signArtifact(privateKeyPem, artifact);
  assert.equal(signature.keyId, keyIdOf(publicKeyPem));
  assert.equal(verifyArtifact(publicKeyPem, artifact, signature).ok, true);

  const tampered = { ...artifact, digest: "3".repeat(64) };
  const result = verifyArtifact(publicKeyPem, tampered, signature);
  assert.equal(result.ok, false);
  assert.match(result.reason, /matcher ikke/);
});

test("en anden nøgle afviser signaturen", () => {
  const { privateKeyPem } = generateKeyPair();
  const { publicKeyPem: other } = generateKeyPair();
  const signature = signArtifact(privateKeyPem, artifact);
  assert.equal(verifyArtifact(other, artifact, signature).ok, false);
});

test("et usigneret artefakt afvises", () => {
  const { publicKeyPem } = generateKeyPair();
  const result = verifyArtifact(publicKeyPem, artifact, null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /ikke signeret/);
});

test("proveniens signeres og verificeres over statement-payloaden", () => {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  const statement = buildProvenance({
    subject: [{ name: "ghcr.io/example/pdp", digest: { sha256: "1".repeat(64) } }],
    sourceCommit: "a".repeat(40),
    builderId: "https://example.org/builder",
    profile: "dev",
    resolvedDependencies: [{ uri: "git+https://example.org/repo", digest: { sha256: "4".repeat(64) } }],
    startedOn: "2026-09-23T09:00:00.000Z",
    finishedOn: "2026-09-23T09:01:00.000Z",
    invocationId: "inv-1",
  });
  const signed = signProvenance(privateKeyPem, statement);
  assert.equal(verifyProvenance(signed, new Map([[keyIdOf(publicKeyPem), publicKeyPem]])).ok, true);

  const tampered = structuredClone(signed);
  tampered.predicate.buildDefinition.externalParameters.sourceCommit = "b".repeat(40);
  assert.equal(verifyProvenance(tampered, new Map([[keyIdOf(publicKeyPem), publicKeyPem]])).ok, false);
});
