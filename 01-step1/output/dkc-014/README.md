# DKC-014 — Reproducerbare artefakter og beskyttet releasevej (leverance)

Implementering af **DKC-014** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-037, DKC-053, DKC-063, DKC-019, DKC-047 og
DKC-056. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-014/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-056` → `dkc-047` → `dkc-019` → `dkc-063` →
  `dkc-053` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1, `openssl` tilgængelig, netværk til
  `registry-1.docker.io`, `gcr.io` og `api.osv.dev`. Docker/cosign/syft/trivy
  og GitHub Actions er **ikke** tilgængelige.

## Forudsætninger og valg

DKC-014 afhænger formelt af DKC-001, DKC-002 og DKC-063. Overlayen lægges oven
på hele den nuværende stak via `dkc-056/apply.sh`, som kæder
`dkc-047/apply.sh` → `dkc-019/apply.sh` → `dkc-063/apply.sh` → … → `dkc-001`.
**DKC-056 er valgt som forudsætning, fordi den er den aktuelle stak-top.**

DKC-014 var den eneste afhængighedstilfredse opgave, men er delvist
miljøblokeret. Valget var derfor at implementere de dele, der kan bygges og
efterprøves **rigtigt** her, og registrere resten ærligt som NOT RUN:

- **Rigtigt implementeret:** statisk Dockerfile-kontrol mod en lås af **rigtige**
  base-image-digester (løst fra `registry-1.docker.io` og `gcr.io`), en
  deterministisk SBOM fra filsystemet, en Ed25519-signatur- og
  digest-/pladsholdergate med `node:crypto`, SLSA-/in-toto-inspireret
  proveniens, en rigtig OSV-scanning af de låste npm-versioner, branch
  protection/CODEOWNERS-validering og en guard mod agent- og selv-godkendelse.
- **NOT RUN med begrundelse:** selve containerbuildet, image-scanningen,
  publiceringen og CI-signeringen (`integration-container-build`), fordi Docker
  ikke findes i WSL-distroen, og fordi signaturnøglen ligger i CI. GitHub
  Actions er slået fra, så workflows er konfiguration.

Ingen påstand om «bygget», «scannet» eller «signeret» er fremsat uden bevis.

## Implementeret adfærd

1. **Fire nye versionerede kontrakter.**
   - `contracts/sbom.schema.json` — deterministisk software-BOM.
   - `contracts/build-provenance.schema.json` — in-toto/SLSA-proveniens.
   - `contracts/artifact-manifest.schema.json` — byggede artefakter, digests,
     SBOM/proveniens og signaturkrav.
   - `contracts/branch-protection.schema.json` — deklarativ grenbeskyttelse.
2. **Semantisk validator** (`conformance/src/supply-chain.mjs`): afviser
   pladsholder-digester (også 64 gyldige hex-tegn som `aaaa…`), `latest`,
   manglende signaturer, ukendte nøgler, ikke-byggede artefakter uden
   begrundelse, beskyttede stier uden ejere og påstande om kryptografisk
   commitsignering.
3. **Deterministisk SBOM** (`supply-chain/src/sbom.mjs`): læser lock- og
   package-filer, oversætter `integrity` til hex, sorterer på purl, udleder
   serienummer og tidsstempel (`SOURCE_DATE_EPOCH`) af indholdet. Committet i
   `release/sbom/platform-sbom.cdx.json` og kontrolleret for sync.
4. **Containerbuilds** (`containers/`): én Dockerfile pr. kontroltjeneste
   (pdp, ai-gateway, audit-service, mattermost-adapter, keycloak-adapter) med
   **rigtige, pinnede** base-digester, non-root runtime og ingen hemmeligheder
   i build-args. `supply-chain/src/containers.mjs` afviser en `FROM` der ikke
   matcher `containers/base-images.lock.json`, og udleder den præcise
   `docker buildx`-kommando.
5. **Signering og proveniens** (`supply-chain/src/signature.mjs`,
   `provenance.mjs`): Ed25519 via `node:crypto` over et kanonisk payload.
   Kun den offentlige nøgle står i `release/trust/release-keys.json`; den
   private læses fra `DKC_RELEASE_SIGNING_KEY`.
6. **Deployment-gate** (`supply-chain/src/release-policy.mjs`,
   `make supply-chain-verify`): afviser pladsholder-digester og usignerede
   images og kræver, at hvert bygget artefakt matcher gitops-manifestets digest
   og har en gyldig signatur.
7. **OSV-scanning** (`supply-chain/src/vuln.mjs`): `make supply-chain-scan`
   henter levende advisories for de låste versioner og cacher dem;
   `make supply-chain-vuln-check` evaluerer offline mod
   `supply-chain/vuln/scan-policy.json` (`critical`/`high` blokerer, med
   mindre et navngivet menneske har godkendt en tidsbegrænset undtagelse).
8. **Beskyttet releasevej** (`security/branch-protection.json`,
   `.github/CODEOWNERS`): pull request, to godkendelser, CODEOWNERS, dismissed
   stale reviews, obligatoriske checks (alle i baseline-registeret), DCO og
   eksplicit **fravalg** af commitsignering. `evaluateProtectedChange` afviser
   enhver agent-godkendelse og enhver selv-godkendelse og kræver en CODEOWNER
   for hver beskyttet sti.
9. **DCO bevaret** (`.github/workflows/dco.yml`, `.github/scripts/check-dco.sh`):
   `Signed-off-by` er en sign-off-linje, ikke kryptografi.
10. **Release-styring**: `release/matrix/test-matrix.json` version 1.1.0 har et
    nyt krav `REQ-SUPPLY-001` med checks `supply-chain-check`,
    `supply-chain-test`, `supply-chain-vuln-check` og den eksterne
    `integration-container-build`, så release-gaten blokerer indtil rigtige
    artefakter findes.

## Ændrede filer (55 leverancefiler)

| Område | Filer |
| --- | --- |
| Kontrakter | `contracts/sbom.schema.json`, `contracts/build-provenance.schema.json`, `contracts/artifact-manifest.schema.json`, `contracts/branch-protection.schema.json` + 4 eksempler |
| Konformans | `conformance/src/supply-chain.mjs`, `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs` |
| Forsyningskæde | `supply-chain/` (11 kilder + 6 testfiler + `package.json`) |
| Containere | `containers/` (5 Dockerfiles, `base-images.lock.json`, `containers.json`, `README.md`) |
| Release | `release/artifacts.json`, `release/sbom/platform-sbom.cdx.json`, `release/trust/release-keys.json`, `release/matrix/test-matrix.json` |
| Beskyttelse | `.github/CODEOWNERS`, `.github/workflows/dco.yml`, `.github/workflows/supply-chain.yml`, `security/branch-protection.json` |
| Byg/CI-registrering | `Makefile`, `tools/baseline/registry.mjs` |
| Dokumentation | `docs/spec/supply-chain.md`, `docs/adr/0032-reproducerbare-artefakter-og-releasevej.md`, `docs/spec/README.md`, `docs/adr/README.md`, `docs/status/supply-chain.md`, `docs/status/implementation-matrix.md`, `docs/testing/test-matrix.md` |

Den fulde, kanoniske liste findes i `evidence/logs/deliverable-files.txt`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — 51 skemaer, 51 eksempler, 4 forsyningskædeeksempler (skema + semantik) |
| `make lint` | PASS — 292 JSON-filer, 746 filer |
| `make test` | PASS — 131/131 |
| `make supply-chain-test` | PASS — 31/31 |
| `make supply-chain-check` | PASS — SBOM/manifest i sync, Dockerfiles, branch protection |
| `make supply-chain-vuln-check` | PASS — 0 advisories for de låste versioner |
| `make supply-chain-containers-check` | PASS — 5 containere pinnet og hærdet |
| `make release-check` | PASS — 24 krav, matrixversion 1.1.0 |
| `make release-test` | PASS |
| `make gitops-test` / `make gitops-verify` | PASS |
| `make supply-chain-verify` | **BLOKERET (exit 1)** — 9 pladsholder-digester i `gitops/manifests/dev` afvises (forventet) |
| `make baseline` | 76 PASS, **1 FAIL** (pre-eksisterende `changelog-check`), 12 NOT RUN, 0 ERROR af 89 |
| `make supply-chain-containers-build` | NOT RUN — Docker findes ikke (`exit 1`) |
| `make supply-chain-sign` | NOT RUN — `DKC_RELEASE_SIGNING_KEY` er ikke sat (`exit 2`) |

Loggene ligger i `evidence/logs/` og baselinekørslen i `evidence/baseline/`.

Den ene FAIL er den kendte, pre-eksisterende `changelog-check`: commits i
checkoutet (også `83ad91a`) mangler DCO-sign-off. Den er ikke forsøgt skjult og
er identisk med DKC-047- og DKC-056-baselinerne.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Ren CI bygger og publicerer sporbare stagingartefakter | **NOT RUN** | Docker findes ikke i WSL-distroen, cosign/syft/trivy er ikke installeret, og Actions er slået fra. Dockerfiles, rigtige pinnede base-digester, byggeplan, artefaktmanifest og proveniens-emitter er implementeret og statisk efterprøvet; selve build/publicering er `integration-container-build` (NOT RUN, se `evidence/logs/supply-chain-containers-build.log`). |
| Placeholder-digest og usigneret image afvises | **PASS** | `supply-chain/test/digest.test.mjs`, `release-policy.test.mjs`, `signature.test.mjs` (31 tests). `make supply-chain-verify` afviser alle 9 pladsholder-digester i `gitops/manifests/dev` (`evidence/logs/supply-chain-verify.log`). |
| App-agent kan ikke godkende sin egen ændring i beskyttede policyfiler | **PASS** | `evaluateProtectedChange` + `supply-chain/test/release-policy.test.mjs`; `security/branch-protection.json` og `.github/CODEOWNERS` valideres af `make supply-chain-check`. |
| DCO-sign-off bevares; må ikke beskrives som kryptografisk commitsignering | **PASS** | `requireDcoSignoff: true` og `requireSignedCommits: false`/`cryptoSigningClaimed: false` i branch protection (semantisk håndhævet); `.github/workflows/dco.yml`; `docs/spec/supply-chain.md`. |

## Ærlige begrænsninger

- **Containerbuild, image-scanning, publicering og CI-signering er NOT RUN.**
  Der er ingen Docker, intet cosign/syft/trivy og ingen Actions. Dockerfiles og
  digests er rigtige, men der er ikke bygget et image her.
- **SBOM'en er bygget og digest-bundet, men usigneret** indtil CI signerer den
  med `DKC_RELEASE_SIGNING_KEY`; derfor står SBOM-artefaktet som
  `built-unsigned`.
- **OSV-scanningen er et øjebliksbillede.** `supply-chain/vuln/cache.json`
  indeholder de levende resultater på `queriedAt` for de **låste** versioner
  (i dag 0 kendte advisories). Politikken afviser en scanning ældre end
  `maxCacheAgeDays`.
- **Dev-manifesterne har bevidste pladsholder-digester.** Gaten afviser dem med
  vilje, indtil rigtige byggede digests pinnes.
- **En grøn enhedstest er ikke produktions- eller CI-status.** Uafhængig
  verifikation er en separat menneskelig handling.

## Sådan efterprøves leverancen

```sh
# frisk checkout
git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-014-verify
cd /tmp/dkc-014-verify && git checkout 83ad91a
/mnt/c/projects/DkCompany/01-step1/output/dkc-014/apply.sh /tmp/dkc-014-verify/00-core
cd 00-core && make install
make validate && make lint && make test
make supply-chain-check && make supply-chain-test && make supply-chain-vuln-check
cd /mnt/c/projects/DkCompany/01-step1/output/dkc-014
sha256sum -c OVERLAY-MANIFEST.txt
```

`OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
`apply.sh` med pakkerod-relative stier.
