# Indsigt og eksport som en tværgående proces

> DKC-020 · ADR-0038. En autoriseret sag skal kunne finde og eksportere de
> rigtige data på tværs af kundens apps — ærligt og afgrænset.

DKC-0.5 gav privacy-verberne og en tynd fan-out. DKC-020 gør processen til en
**holdbar, autoriseret sag** med per-modul status og en **sikret eksport**.
Modulet ligger i [`privacy/`](../../privacy) og bygger på persistenslaget
(DKC-008/013) og de eksisterende apps (DKC-023/024).

## Den holdbare sag

En sag er en række i `dsar_cases` (migration v10) med:

- tenant, verbum, subjekt-identifikatorer og den anmodende part,
- den **autoriserede sagsbehandler** (verificeret menneske, ikke en agent),
- status (`open`/`running`/`partially-completed`/`completed`/`failed`),
- deadline, idempotency-key og den seneste `PrivacySubjectResponse`.

Hvert moduls bidrag er en række i `dsar_module_results` med status, antal
berørte poster, begrundelse/fejl og en evt. artefaktreference. Det er den
**genoptagelige arbejdsenhed**: et modul med terminal status (`full`/`found`/
`partial`/`unsupported`) kaldes ikke igen, mens `failed`/`unknown` forsøges på ny.
En gentagen `openCase` med samme idempotency-key giver ikke to sager.

Den rå modulbesvarelse gemmes i et **artefakt**, ikke i registeret. Dermed bliver
DSAR-registeret ikke selv et nyt personregister.

## Autorisation (default-deny)

`privacy/src/authz.mjs` afviser alt, hvad der ikke er et verificeret menneske i
sagens tenant med rollen `dpo`/`privacy-officer` (eller gruppen
`dpo-approvers`). Derudover er selvbetjening forbudt: man kan ikke behandle sin
egen sag. Autorisationen er et ekstra, deny-only lag og kan lægges oven på
PDP'en.

## Sikker identitetsmatchning

`privacy/src/identity.mjs` normaliserer identifikatorer (fx e-mail til små
bogstaver) og matcher fail-closed:

- en post med en **fremmed tenant** droppes, selv med identisk e-mailtekst,
- en post med en **eksplicit anden ejer** droppes,
- en post uden ejer-/tenant-markør antages afgrænset af modulet og følger med,
- antallet af udeladte poster rapporteres (`dropped`), så eksporten er ærlig.

## Sikret eksport

`privacy/src/export.mjs` udsteder en eksport der er bundet til:

- den tenant sagen tilhører (en fremmed tenant kan ikke indløse den),
- en navngiven **modtager** (et link til en anden afvises),
- et **udløbstidspunkt** (et udløbet link afvises og markeres `expired`),
- et **artefakt med SHA-256** (en manuel ændring opdages ved indløsning),
- et **revisionsspor** (`auditRef`).

Kun subjektets egne poster følger med; andre personers data udelades og tælles.
Metadata (ikke payload) ligger i `dsar_exports` og validerer mod
[`contracts/privacy-export.schema.json`](../../contracts/privacy-export.schema.json).

## Per-modul status

Statusværdierne er `full`, `found`, `partial`, `unsupported`, `failed` og
`unknown`. `partial`/`unsupported` kræver en begrundelse; `failed`/`unknown`
kræver en fejl. En timeout eller en uopnåelig app giver `failed`/`unknown` —
aldrig `full`. Se [`privacy-verbs.md`](privacy-verbs.md).

## Kørsel

```bash
make privacy-check      # eksportkontrakt + fail-closed identitetsmatchning
make privacy-test       # holdbar sag, to-app fan-out, timeout/nedetid, eksport
make privacy-run        # offline demonstration: sag → per-modul status → eksport
```

`privacy-test` starter de **to rigtige adaptere** (Mattermost og Keycloak) med
mock-upstream og kører en sag på tværs af dem. Det er beviset for tværgående
indsigt uden en levende tredjepartsapp.

## Acceptkriterier (DKC-020)

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Syntetisk person på tværs af to rigtige apps findes og eksporteres | PASS (adaptere + mock-upstream) / NOT RUN (levende apps) | `privacy/test/case-service.test.mjs` |
| Samme e-mailtekst i en anden tenant udleveres ikke | PASS | `privacy/test/case-service.test.mjs`, `identity.test.mjs` |
| Timeout og nedetid giver partial/failed, aldrig fuld succes | PASS | `privacy/test/case-service.test.mjs`, `conformance/test/privacy-conformance.test.mjs` |
| Forkert sagsbehandler og udløbet eksportlink afvises | PASS | `privacy/test/authz.test.mjs`, `export.test.mjs` |

## Begrænsninger

- DSAR mod **levende** tredjepartsapps og rigtige kundedata er **NOT RUN**;
  ingen sådanne instanser findes i dette miljø (`integration-privacy-live`).
- Den offline artefaktbutik er i hukommelsen; en deployment bruger en krypteret
  objektbutik med samme `put`/`get`-interface.
- En gendannelse kan genindføre slettede personoplysninger; slettefrister og
  DSAR-status skal rekonsumeres efter en restore (se
  [`upstream-upgrade-rollback.md`](../runbooks/upstream-upgrade-rollback.md)).
