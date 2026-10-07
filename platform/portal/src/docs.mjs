/**
 * DKC-025 — genereret statusdokument for portalen og servicepakkerne.
 *
 * Dokumentet er afledt af de kanoniske servicepakker og den fælles
 * autorisationspolitik, så det ikke kan komme til at love mere end koden gør.
 */
import { ACTIONS } from "./constants.mjs";
import { PORTAL_POLICY } from "./authorization.mjs";
import { orderPreview } from "./packages.mjs";

export function renderPortalDoc(packages) {
  const rows = packages
    .slice()
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name) || a.metadata.version.localeCompare(b.metadata.version))
    .map((pkg) => {
      const preview = orderPreview(pkg);
      return `| ${pkg.metadata.name} | ${pkg.metadata.version} | ${pkg.category} | ${preview.monthly} ${preview.currency} | ${preview.implementation} ${preview.currency} | ${preview.requiresAcknowledgment.length} |`;
    })
    .join("\n");

  const actionRows = Object.values(ACTIONS).map((action) => {
    const policy = PORTAL_POLICY[action];
    return `| \`${action}\` | ${policy.roles.join(", ")} | ${policy.scope} |`;
  }).join("\n");

  return `# Portal og kundelivscyklus

Dette dokument er genereret fra \`portal/service-packages/*.json\` og den
fælles autorisationspolitik i \`portal/src/authorization.mjs\`. Kør
\`make portal-write\` for at genskabe det.

## Servicepakker

En servicepakke er versioneret og bestillingsbar. Prisen er den forventede
månedlige driftspris; hver væsentlig konsekvens skal kunden kvittere for, før
ordren kan oprettes.

| Pakke | Version | Kategori | Månedlig pris | Implementering | Væsentlige konsekvenser |
| --- | --- | --- | ---: | ---: | ---: |
${rows}

## Autorisationspolitik

UI og API kalder den samme \`decidePortalAccess\`. En platformrolle kræver
altid en eksplicit tenant-scope.

| Handling | Roller | Scope |
| --- | --- | --- |
${actionRows}

## Livscyklus

Kundetilstande: \`created → active → suspended → active\` og
\`created|active|suspended → winding-down → closed\`. Afvikling kræver
dokumenteret eksport og sletning, og \`closed\` kræver en anden person end den,
der startede afviklingen. Alle overgange skriver et hash-kædet revisionsspor,
som \`verifyAuditTrail\` kan efterprøve.
`;
}
