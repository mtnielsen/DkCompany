# ADR-0032: Reproducerbare artefakter og en beskyttet releasevej

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-014. GitOps kan i dag installere et image, hvis digest blot er 64 hex-tegn — også et syntetisk `bbbb…` — og ingen har bundet den til et byggeri. Samtidig kan en ændring i en beskyttet policyfil i teorien godkendes af den, der lavede den, hvis autorisationen kun findes i en prompt. Vi mangler en kontraktlig og efterprøvelig binding mellem byggeri, digest, signatur og ejerskab.

## Kontekst og problemstilling

- **Digest er ikke nok.** `gitops/src/verify.mjs` kontrollerer formen `@sha256:<64 hex>`, men ikke om digesten er produceret af en hash. Pladsholdere består.
- **Signatur før deployment.** Et deployet image skal kunne spores til en bygget og signeret digest fra en betroet nøgle.
- **SBOM og proveniens.** Et artefakts indhold skal kunne genskabes og bindes til kilde-commit og builder.
- **Sårbarheder.** De låste afhængigheder skal scannes mod en levende advisory-database, og resultatet skal kunne evalueres deterministisk i CI.
- **Beskyttet vej.** Kontrakter, policy, sikkerhed og releaseværktøj skal have CODEOWNERS og branch protection; en agent må ikke godkende, og forfatteren må ikke godkende sin egen ændring.
- **DCO er ikke kryptografi.** DCO-sign-off bevares, men må ikke beskrives eller håndhæves som kryptografisk commitsignering.
- **Miljøet.** Docker er ikke tilgængeligt i WSL-distroen, cosign/syft/trivy er ikke installeret, og Actions er slået fra. Det skal siges højt frem for at mocke et byggeri.

## Beslutningskriterier

- Versionerede kontrakter for SBOM, proveniens, artefaktmanifest og branch protection.
- En deterministisk SBOM og et deterministisk artefaktmanifest, der kan kontrolleres for drift.
- En rigtig digest-/signaturverifikation med `node:crypto` og et trust anchor, hvor kun den offentlige nøgle committes.
- Pinnede base-images og statisk Dockerfile-kontrol.
- En rigtig sårbarhedsscanning med en offline, ejergodkendt politik.
- CODEOWNERS, branch protection og en guard mod agent- og selv-godkendelse.
- Ærlig registrering af containerbuild, publicering og signering i CI som NOT RUN.

## Overvejede muligheder

- **Kun skærpe regex i `gitops/src/verify.mjs`.** Simpelt, men afviser stadig ikke pladsholdere, binder intet byggeri og rører ikke godkendelse.
- **Stole på et eksternt værktøj alene (cosign/syft/trivy).** Rigtigt i CI, men ingen af dem findes her, og de løser ikke CODEOWNERS eller egen-godkendelse.
- **Kontrakter + deterministisk SBOM + Ed25519-verifikation + OSV-scanning + beskyttet releasevej, med ærlig NOT RUN for containerdelen.** Kræver vedligeholdelse, men gør hver grænse efterprøvelig i dag.

## Beslutning

Vi indfører reproducerbare artefakter og en beskyttet releasevej, håndhævet i
`contracts/{sbom,build-provenance,artifact-manifest,branch-protection}.schema.json`,
`conformance/src/supply-chain.mjs`, `supply-chain/`, `containers/`,
`release/artifacts.json`, `.github/CODEOWNERS` og
`security/branch-protection.json`:

1. **SBOM.** Deterministisk, digest-bundet og genereret fra lock- og package-filer.
2. **Containerbuilds.** Én Dockerfile pr. kontroltjeneste med pinnede base-digests, non-root og ingen hemmeligheder i build-args.
3. **Signering.** Ed25519 via `node:crypto`; kun den offentlige nøgle er trust anchor, den private ligger i CI.
4. **Proveniens.** SLSA-/in-toto-inspireret og signeret over statement-payloaden.
5. **Deployment-gate.** Pladsholder-digester og usignerede images afvises; en tredjepartsdigest skal stadig være rigtig.
6. **Sårbarheder.** OSV-scanning af de låste versioner caches og evalueres offline mod en politik med tidsbegrænsede undtagelser.
7. **Releasevej.** Branch protection kræver pull request, CODEOWNERS, DCO og kendte checks; CODEOWNERS giver navngivne menneskelige ejere.
8. **Autorisation.** En agent kan ikke godkende, og forfatteren kan ikke godkende sin egen ændring i en beskyttet sti.
9. **Ærlighed.** Containerbuild, publicering og CI-signering er `integration-container-build` (NOT RUN), fordi Docker mangler i dette miljø.

Resultatet valideres i `make supply-chain-sbom`, `make supply-chain-check`,
`make supply-chain-test`, `make supply-chain-vuln-check` og release-gaten.

## Konsekvenser

- **Positive:** En digest kan ikke længere flyttes til et andet indhold, en pladsholder afvises, og en beskyttet ændring kræver et menneske, der ejer stien.
- **Negative:** Trust anchor, SBOM og OSV-cache skal vedligeholdes, og den fulde effekt kræver CI med Docker og en signaturnøgle.
- **Neutrale:** DCO forbliver en sign-off-linje; beslutningen slår udtrykkeligt kryptografisk commitsignering fra.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Kun strengere digest-regex | Simpel | Afviser ikke pladsholdere; binder intet byggeri |
| Eksternt værktøj alene | Rigtigt i CI | Findes ikke her; løser ikke ejerskab |
| Kontrakter + verifikation + beskyttet vej | Efterprøveligt i dag | Kræver vedligeholdelse og CI for fuld effekt |

## Mere information

- [`docs/spec/supply-chain.md`](../spec/supply-chain.md)
- [`docs/status/supply-chain.md`](../status/supply-chain.md)
- [`contracts/artifact-manifest.schema.json`](../../contracts/artifact-manifest.schema.json),
  [`contracts/branch-protection.schema.json`](../../contracts/branch-protection.schema.json)
- [`supply-chain/src/release-policy.mjs`](../../supply-chain/src/release-policy.mjs),
  [`supply-chain/src/signature.mjs`](../../supply-chain/src/signature.mjs)
- [ADR-0005](0005-git-eneste-aendringskanal.md), [ADR-0011](0011-sikkerhedsfund-i-evidensplanen.md), [ADR-0015](0015-autentiske-godkendelser.md), [ADR-0020](0020-en-rolle-pr-agent.md), [ADR-0028](0028-testmatrix-og-releasegates.md)
