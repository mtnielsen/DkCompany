# ADR-0055 — Arbejdspladsmodul med én valideret editionkombination

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-026. DKC-023 gav en fælles adapter-SDK, DKC-025 gav
  kunden en portal, og DKC-016/DKC-021 gav backup og slette-/hold-regler. Det
  mangler et første bredt arbejdspladsmodul, hvor filer, deling, kalender og en
  kontoredaktør frigives kontrolleret, og hvor eksterne gæster, offentlige links
  og sletning følger kundepolitikken.

## Kontekst og problemstilling

En arbejdsplads består af flere upstream-produkter (Nextcloud og en
kontoredaktør). Det giver tre konkrete risici:

- **Uafklaret frigivelse.** Hvis fil-, delings-, kalender- og editormodulet
  frigives samlet, kan et delmodul uden valideret licens, API eller driftsprofil
  komme i drift sammen med de øvrige.
- **Utæt deling.** Eksterne gæster og offentlige links er den mest almindelige
  vej til datalækage, hvis de ikke styres af en kundepolitik.
- **Uærlig sletteevne.** Et DSAR-svar, der påstår fuld sletning, er forkert,
  fordi backups, versions-/papirkurvshistorik og søgeindeks ligger uden for
  API'et.

## Beslutningskriterier

- Et nyt adapter-modul oven på den fælles SDK (DKC-023), ikke en ny platform.
- Filer, deling, kalender og editor frigives **pr. delmodul** gennem en
  dokumenteret editionkombination.
- Default-deny delingsbeslutning; tenanten udledes af principalen; kun et
  verificeret menneske må dele, invitere og afvikle.
- Offentlige links og gæster følger kundepolitikken (adgangskode, udløb,
  levetid, domæne-allowlist).
- Offboarding lukker sessioner og delinger; sletning blokeres af legal hold og
  retention og rapporterer resterende kopier.
- Backup/restore erklæres ærligt `partial`/`unsupported`.

## Overvejede muligheder

- **A: Frigiv hele arbejdspladsen som én kandidat.** Enkelt, men et enkelt
  uafklaret delmodul (fx en kontoredaktør uden backup) blokerer eller
  kontaminerer hele frigivelsen.
- **B: Del kun filer og deling, og lad kalender/editor vente.** Færre risici,
  men opfylder ikke "første brede arbejdspladsmodul".
- **C: Et `nextcloud-adapter`-modul med en editionkombination, der frigiver
  hvert delmodul for sig, og en politikstyret delings-/sletteflade oven på
  SDK'en.** Flere bevægelige dele, men hvert acceptkriterium bliver
  efterprøveligt.

## Beslutning

Vi vælger **C**. `modules/nextcloud-adapter/` er det første brede
arbejdspladsmodul:

1. **Én editionskombination** (`service/src/constants.mjs`): Nextcloud Hub +
   ONLYOFFICE frigives; Collabora-varianten frigiver ikke editor-modulet, fordi
   driftsprofilen mangler backup.
2. **Én delingsbeslutning** (`service/src/workspace.mjs`): `decideFileAccess`
   er default-deny og læses af både læsning, redigering og deling.
3. **Kundepolitik** for ekstern deling, offentlige links, offboarding og
   sletning; hver afvisning audits med en begrundelse.
4. **Gæste- og offboardinglivscyklus** mod Nextclouds bruger- og OCS-API.
5. **Ærlige privacy-verber**: locate/export `full`, erase `partial`, legal hold
   `unsupported`, retention `partial`.
6. **Kontrakter og checks** i `contracts/`, `conformance/src/workspace.mjs`,
   `adapter-sdk/registry.json` og `tools/baseline/registry.mjs`.

## Konsekvenser

- Et nyt selvstændigt adapter-modul og en ny førstepartspakke; SBOM'en ændres, og
  `make supply-chain-sbom` skal køres.
- En rigtig Nextcloud og en faktisk WOPI-redigering kan ikke køres i dette
  miljø og registreres ærligt som `integration-nextcloud` (NOT RUN).
- Kandidaten godkendes **ikke** endnu, fordi en testet gendannelse af Nextcloud
  mangler; releaseprofilen viser gaten som `blocked` i stedet for at pynte på
  den.
