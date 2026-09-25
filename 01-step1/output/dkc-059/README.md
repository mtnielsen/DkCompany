# DKC-059 — Providerkontrakter og migrationskontrol

Kumulativ overlay oven på stak-tippet **DKC-031**. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-031/apply.sh` → `dkc-030/apply.sh` → … →
  `dkc-001/apply.sh`. DKC-059 afhænger formelt af **DKC-023** (adapter-SDK og
  godkendelsestest), **DKC-031** (migrations- og exitværktøjer), **DKC-053**
  (installationsprofiler og dependency-resolver) og **DKC-056** (indbyggede og
  eksterne datatjenester). Alle er verificeret i den anvendte stak
  (`evidence/prerequisites.txt`).
- **Miljø:** Node v22.22.1. Ingen levende upstream-provider, intet rigtigt
  credential og ingen menneskelig godkendelse. Capability-forhandlingen,
  kompatibilitetsgaten, backendudskiftningen, appmigrationen, IAM-skiftet,
  afstemningen, read-only, credentialrevokationen og rollbacken er efterprøvet
  deterministisk mod syntetiske fixtures. Den målte udskiftning
  (`make provider-live`) er NOT RUN.

## Implementeret adfærd

1. **Versionsstyret capability-katalog og providerregister.**
   `provider-registry/capabilities.json` dækker syv klasser — `iam`,
   `modelprovider`, `database`, `storage`, `backup`, `queue` og `apps` — med
   obligatoriske og sikkerhedskritiske capabilities og en minimumsversion.
   `provider-registry/providers.json` erklærer pr. provider klasse, produkt,
   version/edition, forbindelsesform og capabilities med version og niveau
   (`enforced`/`advisory`).
2. **Versionsforhandling (`migration/src/provider-negotiate.mjs`).** En
   manglende obligatorisk capability giver `unsupported`; en sikkerhedskritisk
   capability må ikke nedgraderes i niveau eller version; ukendte capabilities
   afvises. Resultatet er `supported`, `degraded` eller `unsupported`.
3. **Supportmatrix (`provider-registry/support-matrix.json`).** Hvert skift
   klassificeres som `drop-in`, `planned-migration` eller `unsupported`. Et
   skift uden en række afvises (`no_compatibility_row`). Der findes **ingen**
   generel påstand om frit skift mellem SQL-motorer eller apps.
4. **Preflight (`preflightSwap`).** Kombinerer klassificering og forhandling og
   stopper et skift **før** ændring. En forbindelsesstreng — også en identisk —
   ændrer aldrig afgørelsen (`connectionStringNeverBypassesGate`), og det er
   efterprøvet eksplicit.
5. **Cutover, afstemning og rollback (`migration/src/provider-swap.mjs`).**
   Poster mappes til en deterministisk mål-id, men bevarer den stabile
   reference `mig:<tenant>:<app>:<entitet>:<kilde-id>` og sporer den. En cutover
   kræver en tilladt preflight, en menneskelig godkendelse af indhold og
   adgangsrettigheder (to-personers) og et snapshot før ændringen. Afstemningen
   opgør antal, checksums, links, autorisation og referencespor. Ved et
   IAM-skift kontrolleres desuden entydig menneskelig/agentidentitet og
   historisk audit-provenance.
6. **Offboarding og rollback.** Den gamle provider sættes **read-only**, dens
   aktive credentials tilbagekaldes, og evidensen bevares. `rollbackSwap`
   gendanner snapshottet, genåbner den gamle provider og gendanner id-mapping og
   rettigheder.
7. **Holdbar butik (`migration/src/provider-store.mjs`).** Filbaseret butik med
   epochs, poster, id-mapping, referencespor, credentialstatus, godkendelser,
   kvitteringer og snapshot/restore.
8. **Adgang (`migration/src/provider-permissions.mjs`).** Default-deny,
   tenantadskilt og rollebeskyttet (`provider-admin`, `provider-operator`,
   `provider-auditor`).
9. **Kontrakter og konformans.** Fem kontrakter og fem eksempler
   (`provider-capability-catalog`, `provider-registry`,
   `provider-support-matrix`, `provider-preflight`, `provider-swap-receipt`),
   semantiske validatorer i `conformance/src/providers.mjs` og afsnit 48 i
   `conformance/src/validate-schemas.mjs`.
10. **Rapport.** `migration/src/provider-check.mjs` og
    `migration/src/provider-cli.mjs` bygger en deterministisk rapport
    (`provider-registry/report/provider-report.json`,
    `docs/provider/provider-report.md`) med `measured: false`.

## Ændrede og nye filer

Se `OVERLAY-MANIFEST.txt` for den fulde, hash-verificerede liste (45
leverancefiler + `README.md`, `apply.sh`, `OVERLAY-MANIFEST.txt` i pakken).
Overordnet:

- Nye data: `provider-registry/{capabilities,providers,support-matrix,policy}.json`,
  `provider-registry/swaps/*.json`, `provider-registry/report/provider-report.json`.
- Ny kode: `migration/src/provider-{model,negotiate,swap,store,permissions,report,check,cli}.mjs`.
- Nye tests: `migration/test/provider-{negotiate,swap}.test.mjs`,
  `conformance/test/provider-conformance.test.mjs`.
- Nye kontrakter/eksempler: `contracts/provider-*.schema.json`,
  `contracts/examples/provider-*.example.json`.
- Konformans: `conformance/src/providers.mjs`, `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`.
- Registry/Makefile: `tools/baseline/registry.mjs`, `Makefile` (targets
  `provider-check/-test/-run/-render/-report/-live` og medtaget i `ci`).
- Release: `release/matrix/test-matrix.json` (`matrixVersion` 1.40.0,
  `REQ-PROVIDER-001`), `release/matrix/threats.json` (`THREAT-PROVIDER-001`),
  `docs/testing/test-matrix.md`, `docs/security/threat-model.md`,
  `docs/status/implementation-matrix.md`.
- Dokumentation: `docs/spec/provider-contracts.md`,
  `docs/operations/provider-swap.md`, `docs/runbooks/provider-swap.md`,
  `docs/adr/0071-providerkontrakter-og-migrationskontrol.md`,
  `docs/adr/README.md`, `docs/provider/provider-report.md`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make provider-check` | PASS (katalog, register, matrix, politik, fixtures) |
| `make provider-test` | PASS (22 unit-tests + 14 konformanstests) |
| `make provider-run` | PASS (9 scenarier) |
| `make provider-render` | PASS (2 artefakter, deterministisk) |
| `make validate` | PASS (skema + semantik, inkl. providerkontrakter) |
| `make lint` | PASS (759 JSON-filer) |
| `make release-check` | PASS (63 krav, matrixversion 1.40.0) |
| `make release-test` | PASS |
| `make baseline` | FAIL — 1 kendt præeksisterende fejl (changelog-check); 249 checks, 194 PASS, 54 NOT RUN |

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Manglende obligatorisk capability stopper skift før ændring | PASS | `missing-capability-stops-switch`; `provider-negotiate.test.mjs` |
| Kritiske security semantics kan ikke nedgraderes til laveste fællesnævner | PASS | `security-critical-not-downgraded`; niveau-/versionsforhandling |
| Afstem antal, checksums, links, autorisation og referencespor efter migration | PASS | `verified-backend-replacement`, `verified-app-migration`; `provider-swap.test.mjs` |
| IAM-skift bevarer entydig menneskelig/agentidentitet og historisk auditprovenance | PASS | `iam-switch-preserves-identity-and-audit`; `provider-swap.test.mjs` |
| Ingen generel påstand om frit skift mellem SQL-motorer eller apps uden migrationsbevis | PASS | `support-matrix-classifies-switches`, `unsupported-swap-rejected`; matrix `unsupported`-rækker |
| Offboarding af gammel provider fjerner aktive rettigheder uden at slette nødvendig evidens | PASS | `receipt.credentials.evidenceRetained`; rollback-test |
| Matching connection string må ikke omgå gaten | PASS | `missing-capability-stops-switch`; `provider-negotiate.test.mjs` |
| Målt udskiftning mod en levende provider | NOT RUN | `make provider-live`; ingen ekstern provider |

## Ærlige begrænsninger

- Den målte backendudskiftning/appmigration mod en **levende** upstream-provider
  er **NOT RUN**. Kun deterministiske fixtures er kørt. `measured: false`.
- `provider-registry/` er et data-/katalogmodul uden egen `package.json`; koden
  ligger i det eksisterende `migration/`-modul, så SBOM'en er uændret og
  `make supply-chain-check` forbliver grøn.
- Baseline-kørslen muterer 31 sporede fixture-filer under
  `modules/*/conformance` (kendt præeksisterende adfærd); de er gendannet fra en
  ren reference-klon og `diff -rq` er tom.
- Den præeksisterende `changelog-check` fejler fortsat (manglende DCO sign-off,
  inkl. `83ad91a`). Den er hverken indført eller «fixet» her.

## Review-identifikatorer

- Base: `5f9fa73`; checkout: `83ad91a`.
- Overlayet er kumulativt oven på DKC-031 (stak-tip). Diff mod en ren
  DKC-031-checkout udgør leverancen.
