/**
 * DKC-014 — genereret statusdokument for forsyningskæden.
 *
 * Dokumentet er deterministisk givet SBOM, artefaktmanifest og den cachede
 * sårbarhedsscanning. Det skrives af `make supply-chain-sbom` og er den
 * menneskelæsbare flade over de samme data, CI-gaten bruger.
 */
import { loadTrustKeys } from "./release-policy.mjs";

const STATUS_LABEL = {
  signed: "SIGNERET",
  "built-unsigned": "BYGGET, USIGNERET",
  "not-built": "IKKE BYGGET",
};

export function renderSupplyChainDoc({ sbom, sbomDigest, manifest, containers, scan, vuln }) {
  const lines = [];
  lines.push("# Forsyningskæde (DKC-014)");
  lines.push("");
  lines.push("> Genereret af `supply-chain/src/cli.mjs`. Kun artefakter der er byggede og signerede må installeres af GitOps; pladsholder-digests og usignerede images afvises af `make supply-chain-verify`.");
  lines.push("");
  lines.push(`**SBOM:** \`release/sbom/platform-sbom.cdx.json\` · **digest:** \`sha256:${sbomDigest}\` · **komponenter:** ${sbom.components.length}`);
  lines.push(`**Kilde-commit:** \`${manifest.sourceCommit}\` · **manifestversion:** ${manifest.metadata.version}`);
  lines.push("");

  lines.push("## Artefakter");
  lines.push("");
  lines.push("| Artefakt | Type | Status | Digest | Signatur | Grund |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const artifact of manifest.artifacts) {
    const digest = artifact.digest ? `\`${artifact.digest.slice(0, 16)}…\`` : "—";
    const signature = artifact.signature ? `\`${artifact.signature.keyId}\`` : "—";
    lines.push(`| \`${artifact.name}\` | ${artifact.type} | ${STATUS_LABEL[artifact.status] ?? artifact.status} | ${digest} | ${signature} | ${artifact.reason ?? "—"} |`);
  }
  lines.push("");

  lines.push("## Containere");
  lines.push("");
  lines.push("| Tjeneste | Repository | Dockerfile | Status |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of containers.catalog.images ?? []) {
    const artifact = manifest.artifacts.find((a) => a.repository === entry.repository);
    lines.push(`| ${entry.component} | \`${entry.repository}\` | \`${entry.dockerfile}\` | ${STATUS_LABEL[artifact?.status] ?? "—"} |`);
  }
  if (!containers.ok) {
    lines.push("");
    lines.push("Statiske Dockerfile-problemer:");
    lines.push("");
    for (const p of containers.problems) lines.push(`- ${p}`);
  }
  lines.push("");

  lines.push("## Betroede signaturnøgler");
  lines.push("");
  lines.push("| Nøgle-id | Algoritme | Ejer |");
  lines.push("| --- | --- | --- |");
  for (const key of loadTrustKeysForDoc(manifest)) {
    lines.push(`| \`${key.keyId}\` | ${key.algorithm} | ${key.owner?.name ?? "—"} |`);
  }
  lines.push("");

  lines.push("## Sårbarhedsscanning");
  lines.push("");
  if (!scan) {
    lines.push("Ingen cachet scanning. Kør `make supply-chain-scan` (kræver netværk).");
  } else {
    lines.push(`**Kilde:** ${scan.source} · **Økosystem:** ${scan.ecosystem} · **Spurgt:** ${scan.queriedAt}`);
    lines.push("");
    if (vuln?.summary) {
      lines.push(`**Resultat:** ${vuln.summary.advisories} advisories på ${vuln.summary.packages} pakker — ${vuln.summary.failed} blokerende, ${vuln.summary.excepted} undtaget.`);
      lines.push("");
    }
    const rows = [];
    for (const dep of scan.dependencies ?? []) {
      for (const id of dep.vulns ?? []) {
        const advisory = scan.advisories?.[id] ?? { id, severity: "unknown", summary: "" };
        rows.push(`| \`${dep.name}@${dep.version}\` | ${id} | ${advisory.severity} | ${advisory.fixedVersions?.[dep.name] ?? "—"} |`);
      }
    }
    if (rows.length === 0) lines.push("Ingen kendte advisories for de låste versioner.");
    else {
      lines.push("| Pakke | Advisory | Alvor | Rettet i |");
      lines.push("| --- | --- | --- | --- |");
      lines.push(...rows);
    }
  }
  lines.push("");

  lines.push("## Ærlige begrænsninger");
  lines.push("");
  lines.push("- **Containerbuild og -publicering er NOT RUN.** Docker er ikke tilgængeligt i dette miljø, så ingen container er bygget, scannet eller publiceret her.");
  lines.push("- **Signering af containere er NOT RUN.** Den private releasesignaturnøgle ligger i CI-hemmeligheden og findes ikke i dette miljø.");
  lines.push("- **SBOM'en er bygget og digest-bundet**, men usigneret indtil CI signerer den.");
  lines.push("- GitOps-manifesterne i `dev` bærer bevidste pladsholder-digests; gaten afviser dem, indtil rigtige byggede digests er pinnet.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("En grøn statisk kontrol er ikke et byggeri. `NOT RUN` er ikke det samme som PASS.");
  lines.push("");
  return lines.join("\n");
}

function loadTrustKeysForDoc(manifest) {
  return manifest.trustAnchor?.keys ?? [];
}
