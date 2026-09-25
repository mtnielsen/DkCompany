/**
 * DKC-014 — SLSA-/in-toto-inspireret proveniens.
 *
 * Proveniensen binder et artefakts digest til builder, kilde-commit og
 * parametre. Den signeres med samme Ed25519-nøgle som artefaktet, så en
 * digest ikke kan flyttes til en anden builder eller et andet commit uden at
 * signaturen brister.
 */
import { canonicalize, digestOfCanonical } from "./digest.mjs";
import { signBytes, verifyBytes } from "./signature.mjs";

export function buildProvenance({
  subject,
  sourceCommit,
  builderId,
  builderVersion = "1.0.0",
  profile,
  resolvedDependencies = [],
  startedOn,
  finishedOn,
  invocationId,
  signature,
}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "BuildProvenance",
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject,
    predicate: {
      buildDefinition: {
        buildType: "https://example.org/build-types/reproducible-artifact/v1",
        buildTypeVersion: "1.0.0",
        externalParameters: {
          sourceCommit,
          profile,
          reproducible: true,
          artifactName: subject[0]?.name,
        },
        resolvedDependencies,
      },
      runDetails: {
        builder: { id: builderId, version: builderVersion },
        metadata: { invocationId, startedOn, finishedOn },
      },
    },
    signature,
  };
}

/** Det payload provenienssignaturen dækker (alt undtagen signaturen selv). */
export function provenancePayload(statement) {
  return Buffer.from(
    canonicalize({
      _type: statement._type,
      subject: statement.subject,
      predicateType: statement.predicateType,
      predicate: statement.predicate,
    }),
    "utf8"
  );
}

export function signProvenance(privateKeyPem, statement) {
  const signature = signBytes(privateKeyPem, provenancePayload(statement));
  return { ...statement, signature };
}

export function verifyProvenance(statement, publicKeys) {
  const publicKeyPem = publicKeys.get?.(statement.signature?.keyId) ?? publicKeys[statement.signature?.keyId];
  if (!publicKeyPem) return { ok: false, reason: `proveniensens nøgle '${statement.signature?.keyId}' er ikke betroet` };
  return verifyBytes(publicKeyPem, provenancePayload(statement), statement.signature);
}

export function provenanceDigest(statement) {
  return digestOfCanonical(statement);
}
