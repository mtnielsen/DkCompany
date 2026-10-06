/**
 * DKC-023 — kandidatrapport og releaseprofil pr. upstream-version/edition.
 *
 * En `IntegrationCandidate` (DKC-002) beskriver ét upstream-produkt på en eksakt
 * version/edition: licens, hosting, SSO, API, isolation, eksport, backup og
 * pris. Et releaseprofil binder den kandidat til adapterens verbumskontrakt:
 * hvilket conformance-niveau hvert verbum har på netop denne version/edition,
 * hvilke versionsserier adapteren forhandler med, og om kandidaten kan
 * godkendes.
 *
 * Godkendelsesgaten er hård: manglende obligatorisk SSO eller en uafklaret
 * licens stopper kandidaten. `unknown` er ikke "sandsynligvis fint".
 */
import { VERB_GROUPS } from "../../conformance/src/manifest.mjs";

export const OPS_VERBS = VERB_GROUPS.ops;
export const PRIVACY_VERBS = VERB_GROUPS.privacy;

const CAPABILITY_FIELDS = ["sso", "scim", "api", "isolation", "export", "backup"];

/**
 * Den hårde godkendelsesgate. Returnerer `{ status, blockers }` hvor ethvert
 * blocker-element er en menneskelæsbar, maskinelt udledt grund.
 */
export function assessCandidateGate({ candidate, requiredSso = true } = {}) {
  const blockers = [];
  if (!candidate) return { status: "blocked", blockers: ["kandidaten mangler"] };
  if (requiredSso && candidate.sso?.supported !== true) {
    blockers.push("manglende obligatorisk SSO");
  }
  if (!candidate.license || candidate.license.type === "unknown" || !candidate.license.spdx) {
    blockers.push("uafklaret licens");
  }
  if (candidate.hosting?.mode === "unknown") blockers.push("uafklaret hostingmodel");
  if (candidate.maintenance?.vendorSupport === "unknown") blockers.push("uafklaret vedligeholdelse");
  for (const field of CAPABILITY_FIELDS) {
    if (candidate[field]?.capability === "unknown") blockers.push(`ukendt egenskab: ${field}`);
  }
  if (candidate.verification?.status !== "approved") blockers.push("kandidaten er ikke godkendt af et navngivet menneske");
  return { status: blockers.length ? "blocked" : "approved", blockers };
}

function verbEntry(block, fallbackReason) {
  const entry = { conformance: block?.conformance ?? "unsupported" };
  if (entry.conformance !== "full") entry.reason = block?.reason ?? fallbackReason ?? "ikke undersøgt for denne version/edition";
  else {
    if (block?.endpoint) entry.endpoint = block.endpoint;
    if (block?.evidence) entry.evidence = block.evidence;
  }
  return entry;
}

/**
 * Byg et releaseprofil ud fra en kandidat og et modulmanifest.
 */
export function buildReleaseProfile({ candidate, manifest, negotiation = {}, nativeAdmin = {}, verification = {} } = {}) {
  if (!candidate) throw new Error("buildReleaseProfile kræver en kandidat");
  if (!manifest) throw new Error("buildReleaseProfile kræver et modulmanifest");
  const verbMatrix = {};
  for (const verb of OPS_VERBS) verbMatrix[verb] = verbEntry(manifest.verbs?.[verb], `ikke deklareret for ${manifest.metadata?.name ?? "modulet"}`);
  const privacyMatrix = {};
  for (const verb of PRIVACY_VERBS) privacyMatrix[verb] = verbEntry(manifest.privacy?.[verb], `ikke deklareret for ${manifest.metadata?.name ?? "modulet"}`);

  const gate = assessCandidateGate({ candidate, requiredSso: negotiation.requiredSso !== false });
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "UpstreamReleaseProfile",
    metadata: {
      name: `${candidate.name}-${candidate.exactVersion}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      version: "1.0.0",
      description: `Releaseprofil for ${candidate.name} ${candidate.exactVersion} (${candidate.edition?.name ?? "ukendt edition"}).`,
      accountableHuman: candidate.metadata?.accountableHuman,
    },
    upstream: {
      vendor: candidate.upstream?.vendor ?? "unknown",
      product: candidate.name,
      exactVersion: candidate.exactVersion,
      edition: candidate.edition?.name ?? null,
      tier: candidate.edition?.tier ?? "other",
    },
    candidateRef: candidate.metadata?.name ? `${candidate.metadata.name}.json` : null,
    negotiation: {
      supportedRanges: negotiation.supportedRanges ?? [],
      supportedEditions: negotiation.supportedEditions ?? [],
      onUnsupported: negotiation.onUnsupported ?? "refuse",
    },
    verbMatrix,
    privacyMatrix,
    nativeAdmin: {
      exposed: nativeAdmin.exposed ?? false,
      protectedBy: nativeAdmin.protectedBy ?? ["adapter", "pdp", "network-policy"],
      evidence: nativeAdmin.evidence ?? [],
    },
    approvalGate: {
      requiredSso: negotiation.requiredSso !== false,
      licenseType: candidate.license?.type ?? "unknown",
      status: gate.status,
      blockers: gate.blockers,
    },
    verification: verification.verifiedBy
      ? verification
      : {
          status: candidate.verification?.status ?? "candidate_not_approved",
          verifiedBy: candidate.verification?.verifiedBy,
          verifiedAt: candidate.verification?.verifiedAt,
          evidence: candidate.verification?.evidence ?? [],
        },
  };
}

/** Find kandidatfilen for et modulnavn i contracts/examples. */
export function candidateFilename(moduleName) {
  return `integration-candidate.${moduleName}.example.json`;
}

/** Er to releaseprofiler identiske (til `make adapter-sdk-check`)? */
export function releaseProfileEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
