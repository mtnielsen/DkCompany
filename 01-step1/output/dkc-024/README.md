# DKC-024 — Bevis Keycloak og Mattermost mod rigtige instanser (leverance)

Implementering af **DKC-024** for `mtnielsen/DkCompany`. Bygger på DKC-001 ..
DKC-023. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-024/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-023` → `dkc-064` → `dkc-018` → `dkc-015` →
  `dkc-014` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. Ingen rigtige Mattermost-/Keycloak-instanser, ingen
  stagingklynge, intet Docker/cosign/trivy/tofu/kubectl.

## Forudsætninger og valg

DKC-024 afhænger formelt af DKC-003, DKC-015 og DKC-023. Forudsætningerne er
verificeret i kode, ikke i et statusfelt:

- `identity/src/compat.mjs` + `identity/src/identity.mjs` (DKC-003) giver
  verificerbar identitet; demo-shim kan kun konstrueres i `profile: "test"`.
- `adapter-sdk/src/sdk.mjs`, `candidates.mjs` og
  `contracts/examples/upstream-release-profile.*` (DKC-023) pinnede allerede en
  eksakt upstream-version/edition og erklærede conformance pr. verbum.
- `conformance/src/evidence-mode.mjs` (DKC-018) gør et fixture-pass og et
  driftsbevis adskilt; `docs/spec/evidence-modes.md`.
- Mattermost-adapteren er bygget på SDK'en; Keycloak-adapteren har samme
  verbumskæde og fik i DKC-023 bevaret upstream-status.

Der fandtes **ingen** miljøbinding, **ingen** live-prøve mod upstream, **ingen**
opgraderings-/rollbackplan og **intet** uafhængigt demo-værn i verbumskæden.
Opgaven er delvist miljøblokeret: der findes ingen rigtig Mattermost/Keycloak at
køre mod. Valget var at implementere pinningen, live-køreren,
demo-værnet, partial-ærligheden og opgraderings-/rollbackplanen **rigtigt** og
køre dem mod injiceret fetch/mock, mens rigtige upstream-instanser registreres
ærligt som **NOT RUN** med den præcise blokering.

## Implementeret adfærd

1. **Pinning pr. adapter** `adapter-sdk/live-targets.json`: Mattermost `10.0.0`
   (Enterprise), Keycloak `26.0.0` (upstream), med miljøbindinger, scopes,
   rate-limit-håndtering, restdata og de dokumenterede privacy-verber.
   `adapter-live-check` afviser en fil hvis version/edition/SSO ikke matcher den
   godkendte releaseprofil og kandidat.
2. **Live-kører** `adapter-sdk/src/live.mjs`: læser `DKC_LIVE_*`-bindinger, kalder
   adapterens flade og skriver en `EvidenceRecord` med mode `integration` bundet
   til commit/image/miljø/upstream-version/run-ID/udløb. Uden binding er hver
   prøve `not-run` med begrundelse — aldrig `pass`. Et privacy-verbum erklæret
   `partial`, der svarer `partial: false`, giver `fail`.
3. **Uafhængigt demo-værn** `adapter-sdk/src/guards.mjs`: en principal med
   `demo: true` afvises med `401 demo_forbidden` uden for `profile: "test"`, både
   i SDK'ens verbumskæde og i Keycloak-adapteren. Dækker en fejlkonfigureret eller
   kompromitteret authenticator, ikke kun konstruktionsvejen.
4. **Opgraderings-/rollbackplan** `adapter-sdk/src/upgrade.mjs` +
   `contracts/upstream-upgrade-plan.schema.json` + `conformance/src/adapter-live.mjs`:
   deterministisk plan med preflight (version, frisk backup, kapacitet), trin
   (dræn → snapshot → opgradering → genåbn), verifikation (health, central
   identitet, privacy) og obligatorisk rollback. En målversion uden for serien
   blokerer og kræver en ny kandidat; en kandidat uden afprøvet gendannelse
   blokerer rollback.
5. **Registrering**: Makefile-mål `adapter-live-check/-test/-plan/-run/-write`,
   baseline-checks (`adapter-live-check` contract, `adapter-live-test` real,
   `integration-adapter-live` integration/`external: true`) og en
   `adapter-live`-komponent. Testmatrixen er hævet til 1.6.0 med
   `REQ-ADAPTER-002`.
6. **Dokumentation**: `docs/spec/adapter-live-integration.md` (scopes, rate
   limits, restdata, opgraderingsforløb), `docs/runbooks/upstream-upgrade-rollback.md`,
   `docs/status/adapter-live.md` (genereret), ADR-0037 og opdaterede indekser.
7. **Ingen ny `package.json`** — SBOM, artefaktmanifest og
   `docs/status/supply-chain.md` er uændrede; `make supply-chain-check` er grøn.

## Ændrede filer

Se `evidence/logs/deliverable-files.txt` for den fulde, maskinelt udledte liste
(32 filer). Hovedpunkter:

- Nye: `adapter-sdk/live-targets.json`, `adapter-sdk/src/{live,upgrade,guards,live-cli}.mjs`,
  `adapter-sdk/test/{live,upgrade,demo-guard}.test.mjs`,
  `conformance/src/adapter-live.mjs`, `conformance/test/adapter-live-conformance.test.mjs`,
  `contracts/upstream-upgrade-plan.schema.json` + 2 eksempler,
  `docs/spec/adapter-live-integration.md`, `docs/runbooks/upstream-upgrade-rollback.md`,
  `docs/status/adapter-live.md`, `docs/adr/0037-…`.
- Ændrede: `adapter-sdk/src/sdk.mjs`, begge adapteres `server.mjs`/`cli.mjs`,
  `conformance/src/{schemas,validate-schemas}.mjs`, `Makefile`,
  `tools/baseline/registry.mjs`, `release/matrix/test-matrix.json` (1.6.0),
  `docs/status/implementation-matrix.md`, `docs/testing/test-matrix.md`,
  `README.md`, `docs/spec/README.md`, `docs/adr/README.md`.

Deliverable-sættet er beregnet ved at diffe arbejdstræet mod et referenceklon med
kun `dkc-023/apply.sh` lagt (`diff -rq --exclude=node_modules
--exclude=.conformance-out --exclude=.git`); nye mapper er gennemgået rekursivt.
Kørsels-muterede fixtures (`modules/*/conformance/**`, 30 filer) er gendannet fra
referenceklonen, så de ikke indgår.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS |
| `make lint` | PASS |
| `make adapter-live-check` | PASS |
| `make adapter-live-test` | PASS (14 adapter-sdk-tests + 4 conformance-tests) |
| `make adapter-live-plan` | PASS |
| `make adapter-sdk-check` | PASS |
| `make adapter-sdk-test` | PASS (ingen regression) |
| `make adapter-test` / `make iam-adapter-test` | PASS |
| `make release-check` / `make release-test` | PASS |
| `make supply-chain-check` / `make supply-chain-test` | PASS |
| `make baseline` | 88 pass, 1 fail (kendt `changelog-check`), 17 not run |

Logfiler ligger i `evidence/logs/`; den fulde baseline i `evidence/baseline/`.

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Begge adaptere passerer live integration med syntetiske data | **NOT RUN** | Ingen rigtige instanser/credentials. Kører + pinning er efterprøvet med injiceret fetch (`adapter-live-test`); live er `integration-adapter-live` NOT RUN. |
| Ingen demo-header giver produktionsadgang | **PASS** | `adapter-sdk/src/guards.mjs`; `adapter-sdk/test/demo-guard.test.mjs`; begge adaptere svarer `401 demo_forbidden`. |
| Sletning/hold rapporteres ærligt som partial | **PASS** | Releaseprofilerne erklærer `partial`/`unsupported`; live-køreren fejler ved `partial: false` (testet). |
| Den testede edition kan faktisk bruge den valgte centrale identitet | **PASS (kontrakt) / NOT RUN (live)** | Pinning + SSO-gate i `adapter-live-check`/`upgrade`; selve OIDC-loginet kræver en levende instans. |
| Én upstreamopgradering og rollback/gendannelse er demonstreret | **NOT RUN** | Plan og semantik genereret/valideret (`adapter-live-plan`, skema + tests); selve opgraderingen kræver et levende miljø. |

## Resterende begrænsninger

- Den samlede live-integration, den faktiske upstream-opgradering og en rigtig
  rollback er **ikke demonstreret** — de kræver rigtige Mattermost-/Keycloak-
  instanser, credentials og en stagingklynge og er ærligt registreret NOT RUN.
- Opgraderingsplanernes målversioner (`10.1.0`, `26.1.0`) er syntetiske
  inden-for-serien-eksempler, ikke godkendte kandidater.
- En gendannelse kan genindføre slettede personoplysninger; runbooken kræver
  derfor rekonsumering af slettefrister og DSAR-status efter rollback.
- Den forudgående `changelog-check`-FAIL (manglende DCO sign-off) er dokumenteret
  og ikke ændret i denne opgave.

## Verifikation af pakken

- `OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
  `apply.sh` med SHA256 og pakkerod-relative stier; verificeret med
  `sha256sum -c`.
- `apply.sh` er kørt end-to-end på et friskt `83ad91a`-klon og giver et træ, der
  er byte-identisk med arbejdsklonen, hvorefter de fokuserede checks er grønne.
