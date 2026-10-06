# Reproducerbare artefakter og beskyttelse af releasevejen (DKC-014)

GitOps skal installere **de artefakter, CI faktisk har bygget og kontrolleret** —
ikke det, en udvikler påstod. Denne spec beskriver, hvordan platformen binder et
deployet image til en bygget, scannet og signeret digest, og hvordan selve
releasevejen (kontrakter, policy, sikkerhed, CI) beskyttes mod utilsigtet eller
egenrådig ændring.

## Problem

Uden en sådan binding kan tre fejl snige sig ind:

1. **Pladsholder-digest.** Et manifest skriver `@sha256:bbbb…` og ser «pinnet»
   ud, fordi det er 64 hex-tegn, men digesten er aldrig produceret af en hash.
2. **Usigneret image.** En digest peger på et image, som ingen har bygget eller
   signeret, så GitOps installerer et andet indhold end det, der blev testet.
3. **Egen godkendelse.** En app-agent eller forfatteren selv godkender en
   ændring i en beskyttet policyfil. Autorisationen skal håndhæves af identitet
   og ejerskab, ikke af en prompt.

## Kontrakter

| Kontrakt | Indhold |
| --- | --- |
| [`contracts/sbom.schema.json`](../../contracts/sbom.schema.json) | Deterministisk software-BOM (CycloneDX-inspireret) med komponenter, purls og hashes. |
| [`contracts/build-provenance.schema.json`](../../contracts/build-provenance.schema.json) | in-toto/SLSA-inspireret proveniens: subject-digest, builder, kilde-commit, parametre og signatur. |
| [`contracts/artifact-manifest.schema.json`](../../contracts/artifact-manifest.schema.json) | Den kanoniske fortegnelse over byggede artefakter, deres digests, SBOM/proveniens og signaturkrav. |
| [`contracts/branch-protection.schema.json`](../../contracts/branch-protection.schema.json) | Deklarativ grenbeskyttelse: pull request, CODEOWNERS, obligatoriske checks, DCO — ikke kryptografisk commitsignering. |

Semantikken håndhæves i [`conformance/src/supply-chain.mjs`](../../conformance/src/supply-chain.mjs):
pladsholder-digester, manglende signaturer, ukendte nøgler, `latest`,
beskyttede stier uden ejere og påstande om kryptografisk commitsignering
afvises.

## Deterministisk SBOM

[`supply-chain/src/sbom.mjs`](../../supply-chain/src/sbom.mjs) læser de faktiske
`package-lock.json`- og `package.json`-filer, oversætter lockfilens `integrity`
til hex og sorterer komponenterne på purl. Tidsstemplet kommer fra
`SOURCE_DATE_EPOCH` (default epoch), og serienummeret udledes af indholdet.
Samme trægiver derfor samme SBOM og samme digest. `make supply-chain-check`
regenererer SBOM'en og fejler, hvis den committede fil er ude af trit.

## Containerbuilds

[`containers/`](../../containers) indeholder en Dockerfile pr. kontroltjeneste
(pdp, ai-gateway, audit-service, mattermost-adapter, keycloak-adapter) og en
lås over de pinnede base-images. `supply-chain/src/containers.mjs` afviser et
Dockerfile, hvis en `FROM` ikke er `@sha256:<64 hex>`, hvis digesten ikke
matcher `containers/base-images.lock.json`, hvis den sidste stage kører som
root, eller hvis et `ARG`/`ENV` bærer en hemmelighed. `containers/containers.json`
binder tjenesten til sit repository, så artefaktmanifestet kan genereres.

## Signering og proveniens

Releaseartefakter signeres med Ed25519 via `node:crypto`
([`supply-chain/src/signature.mjs`](../../supply-chain/src/signature.mjs)).
Signaturen dækker et kanonisk payload: navn, digest, SBOM-digest,
proveniens-digest og kilde-commit. Den private nøgle ligger i CI-hemmeligheden
`DKC_RELEASE_SIGNING_KEY` og committes aldrig; kun den offentlige halvdel står i
[`release/trust/release-keys.json`](../../release/trust/release-keys.json).
`make supply-chain-verify` afviser et deployet image, hvis digesten er en
pladsholder, hvis repositoryet ikke er et bygget artefakt, eller hvis
signaturen ikke kan verificeres mod trust anchor.

Proveniensen ([`supply-chain/src/provenance.mjs`](../../supply-chain/src/provenance.mjs))
binder subject-digesten til builder, kilde-commit og parametre og signeres over
statement-payloaden.

## Sårbarhedsscanning

`make supply-chain-scan` spørger OSV-databasen for de præcise npm-versioner i
lockfilerne og cacher resultatet i `supply-chain/vuln/cache.json`.
`make supply-chain-vuln-check` evaluerer den cachede scanning offline mod
[`supply-chain/vuln/scan-policy.json`](../../supply-chain/vuln/scan-policy.json): `critical` og `high` blokerer, med
mindre et navngivet menneske har godkendt en tidsbegrænset undtagelse. En
scanning ældre end `maxCacheAgeDays` afvises.

## Beskyttelse af releasevejen

- [`security/branch-protection.json`](../../security/branch-protection.json)
  kræver pull request, to godkendelser, CODEOWNERS-review, dismissed stale
  reviews og et sæt obligatoriske statuskontroller, der alle findes i
  baseline-registeret. `allowForcePushes`, `allowDeletions` og
  `requireSignedCommits` er `false`; `cryptoSigningClaimed` er `false`.
- [`.github/CODEOWNERS`](../../.github/CODEOWNERS) giver navngivne menneskelige
  ejere på `contracts/`, `policy/`, `security/`, `.github/`, `release/`,
  `supply-chain/` og `containers/`. En ejer der ser ud som en agent afvises.
- `evaluateProtectedChange` afviser enhver godkendelse fra en agent og enhver
  selv-godkendelse. En ændring i en beskyttet sti kræver en godkender, der er
  CODEOWNER for netop den sti.

## DCO

DCO er en **sign-off-linje** (`Signed-off-by`), ikke kryptografisk
commitsignering. Workflowet [`.github/workflows/dco.yml`](../../.github/workflows/dco.yml)
og `.github/scripts/check-dco.sh` håndhæver samme regel som `make changelog-check`.
Branch protection kræver DCO, men slår ikke commitsignering til og påstår det
heller ikke.

## Kommandoer

```sh
make supply-chain-sbom              # SBOM + artefaktmanifest + statusdokument
make supply-chain-check             # SBOM/manifest i sync, Dockerfiles, beskyttelse
make supply-chain-test              # enhedstests for hele modulet
make supply-chain-vuln-check        # offline sårbarhedspolitik
make supply-chain-scan              # levende OSV-scanning (netværk)
make supply-chain-containers-check  # statisk Dockerfile-kontrol
make supply-chain-containers-plan   # byggeplan
make supply-chain-containers-build  # kræver Docker; ellers NOT RUN
make supply-chain-sign              # kræver DKC_RELEASE_SIGNING_KEY; ellers NOT RUN
make supply-chain-verify            # afvis pladsholder-/usignerede deployment-digests
```

## Ærlige begrænsninger

Docker er ikke tilgængeligt i WSL-distroen, og cosign/syft/trivy er ikke
installeret. GitHub Actions er slået fra på repo-niveau. Derfor er selve
containerbyggen, publiceringen, scanningen af imageindhold og signeringen i CI
registreret som **NOT RUN** (`integration-container-build` og
`integration-github-actions`). Det, der er efterprøvet her, er den statiske
kontrol, byggeplanen, den deterministiske SBOM, digest-/pladsholderafvisningen,
Ed25519-signaturverifikationen, OSV-scanningen af de låste versioner og
beskyttelsen af releasevejen.

Se [`docs/status/supply-chain.md`](../status/supply-chain.md) for den genererede
status og [ADR-0032](../adr/0032-reproducerbare-artefakter-og-releasevej.md) for
beslutningen.
