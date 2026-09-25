import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkArtifactManifest, checkReleaseProtection, evaluateProtectedChange, ownersFor, parseCodeowners, patternToRegex, verifyDeployments } from "../src/release-policy.mjs";
import { generateKeyPair, keyIdOf, signArtifact } from "../src/signature.mjs";
import { digestOfBytes } from "../src/digest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CODEOWNERS = `/contracts/  @alice @platform-security
/policy/    @alice
/supply-chain/ @bob
`;
const rules = parseCodeowners(CODEOWNERS);

test("CODEOWNERS-regler oversættes og sidste match vinder", () => {
  assert.equal(patternToRegex("/contracts/").test("contracts/examples/x.json"), true);
  assert.deepEqual(ownersFor("policy/bundles/x.json", rules), ["@alice"]);
  assert.deepEqual(ownersFor("supply-chain/src/cli.mjs", rules), ["@bob"]);
  assert.deepEqual(ownersFor("docs/readme.md", rules), []);
});

test("en agent kan ikke godkende sin egen beskyttede ændring", () => {
  const change = { author: { subject: "agent:app-1", kind: "agent", role: "implementer" }, paths: ["policy/bundles/x.json"] };
  const approvals = [{ subject: "agent:app-1", kind: "agent", role: "implementer", handle: "app-1", verdict: "approve" }];
  const result = evaluateProtectedChange(change, approvals, { protectedPaths: ["policy/"], codeownersRules: rules });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /agent/.test(r)));
  assert.ok(result.reasons.some((r) => /egen ændring/.test(r)));
});

test("selv-godkendelse afvises selv for et menneske", () => {
  const change = { author: { subject: "oidc|alice", kind: "human", role: "implementer" }, paths: ["policy/x.json"] };
  const approvals = [{ subject: "oidc|alice", kind: "human", role: "architect", handle: "alice", verdict: "approve" }];
  const result = evaluateProtectedChange(change, approvals, { protectedPaths: ["policy/"], codeownersRules: rules });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /egen ændring/.test(r)));
});

test("en menneskelig CODEOWNER kan godkende", () => {
  const change = { author: { subject: "oidc|carol", kind: "human", role: "implementer" }, paths: ["policy/x.json"] };
  const approvals = [{ subject: "oidc|alice", kind: "human", role: "architect", handle: "alice", verdict: "approve" }];
  const result = evaluateProtectedChange(change, approvals, { protectedPaths: ["policy/"], codeownersRules: rules });
  assert.equal(result.ok, true);
});

test("branch protection i repoet kræver CODEOWNERS, DCO og kendte checks", () => {
  const result = checkReleaseProtection(repoRoot);
  assert.deepEqual(result.problems, []);
});

function tempDeployRoot(imageDigest, repository = "ghcr.io/example/app") {
  const root = mkdtempSync(join(tmpdir(), "dkc014-deploy-"));
  mkdirSync(join(root, "gitops", "manifests", "dev"), { recursive: true });
  writeFileSync(
    join(root, "gitops", "manifests", "dev", "app.json"),
    JSON.stringify({ kind: "Deployment", spec: { template: { spec: { containers: [{ name: "app", image: `${repository}@sha256:${imageDigest}` }] } } } })
  );
  return root;
}

function signedManifest(digest, repository = "ghcr.io/example/app") {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  const artifact = {
    name: repository,
    type: "container-image",
    status: "signed",
    repository,
    builder: "containers/app/Dockerfile",
    sourceCommit: "a".repeat(40),
    digest,
    signature: null,
    sbom: null,
    provenance: null,
  };
  artifact.signature = signArtifact(privateKeyPem, artifact);
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ArtifactManifest",
    metadata: { name: "m", version: "1.0.0", description: "test", accountableHuman: { subject: "oidc|a", name: "A", role: "Owner" } },
    sourceCommit: "a".repeat(40),
    trustAnchor: { keys: [{ keyId: keyIdOf(publicKeyPem), algorithm: "ed25519", publicKeyPem, owner: { subject: "oidc|b", name: "B", role: "Security" } }] },
    policy: { requirePinnedDigest: true, requireSignature: true, requireSbom: true, requireProvenance: true },
    artifacts: [artifact],
  };
}

test("et signeret artefakt accepteres, et pladsholder-digest afvises", () => {
  const digest = digestOfBytes("app-image");
  const root = tempDeployRoot(digest);
  assert.equal(verifyDeployments(root, signedManifest(digest)).ok, true);

  const placeholderRoot = tempDeployRoot("a".repeat(64));
  const result = verifyDeployments(placeholderRoot, signedManifest(digest));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /pladsholder/.test(p)));
});

test("et usigneret artefakt afvises", () => {
  const digest = digestOfBytes("app-image");
  const root = tempDeployRoot(digest);
  const manifest = signedManifest(digest);
  manifest.artifacts[0] = { ...manifest.artifacts[0], status: "built-unsigned", signature: null };
  const result = verifyDeployments(root, manifest);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => /ikke er et signeret artefakt/.test(p)));
});

test("checkArtifactManifest afviser en pladsholder-digest i manifestet", () => {
  const manifest = signedManifest("a".repeat(64));
  const result = checkArtifactManifest(repoRoot, manifest);
  assert.equal(result.ok, false);
});
