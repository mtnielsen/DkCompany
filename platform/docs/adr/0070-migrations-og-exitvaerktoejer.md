# Migrations- og exitværktøjer

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-10-04
- **Beslutningsdrev:** DKC-031 kræver, at en virksomhed kan flytte ind og ud uden at miste indhold og rettigheder: ét valgt kildeformat pr. pilotapp, en dækningsmatrix, en afstemt dry-run, en resumabel og idempotent import, en læsbar exit-eksport og en cutover-/rollback-procedure med menneskelig godkendelse.

## Kontekst og problemstilling

Platformen har pilotapps fra flere upstream-produkter (Nextcloud, OpenProject,
BookStack, Zammad, EspoCRM), en fælles adapter-SDK (DKC-023), dedup (DKC-043),
retention og legal hold (DKC-021), en portal med kundens livscyklus (DKC-025) og
CRM med entydigt ejerskab (DKC-030). Der mangler imidlertid en kontrolleret vej
**ind og ud**. En naiv migration kan importere en anden kundes data gennem en
manglende tenantgrænse, skabe dubletter ved et retry, tabe kommentarer, bilag
eller ACL uden at vise det, levere en eksport der ikke kan læses uden
platformen, eller gennemføre en cutover uden en menneskelig godkendelse og uden
en vej tilbage. En upstream-id er desuden ikke tenantafgrænset.

## Beslutningskriterier

- Vælg **ét** dokumenteret kildeformat pr. pilotapp, som kan læses uden
  platformen.
- Gør importen afhængig af en dry-run, der afstemmer antal og checksums og viser
  tabt funktionalitet før cutover.
- Gør importen resumabel og idempotent; flet aldrig dublerede forretningsposter
  automatisk.
- Dæk ejerskab, timestamps, kommentarer, bilag, ACL og links eksplicit i en
  dækningsmatrix.
- Gør exit-eksporten selvbeskrivende og læsbar uden platformen.
- Gør cutover afhængig af en afstemt import, en dokumenteret rollback og en
  menneskelig pilotgodkendelse af både indhold og adgangsrettigheder.
- Bevar default-deny og tenantisolation.

## Overvejede muligheder

- **A:** Importer frit med et engangsscript, og stol på at operatøren rydder op.
- **B:** Byg et `migration/`-modul med ét valgt kildeformat pr. pilotapp, en
  dækningsmatrix, dry-run, resumabel og idempotent import, dublethåndtering uden
  automatisk fletning, en selvbeskrivende exit-eksport og en
  cutover-/rollback-procedure med pilotgodkendelse.
- **C:** Løs det pr. app uden en fælles kontrakt.

## Beslutning

Vi vælger **B**. `migration/sources.json` beskriver pr. pilotapp det valgte
format, entitetstyper, roller, dedup-nøgler og de seks facetter.
`migration/src/references.mjs` bygger den stabile reference
`mig:<tenant>:<app>:<entityType>:<sourceObjectId>` og afviser
tværtenant-referencer. `migration/src/coverage.mjs` beregner dækningsmatricen og
tabt funktionalitet. `migration/src/mapping.mjs` mapper drevet af de erklærede
facetter og fabrikerer aldrig data. `migration/src/dedup.mjs` gør importen
idempotent og flettes aldrig automatisk (DKC-043's `assertStorageDedupAllowed`).
`migration/src/import.mjs` giver en afstemt dry-run, en resumabel og idempotent
import med checkpoint og fejlliste samt en `reconcile`. `migration/src/export.mjs`
skriver en selvbeskrivende pakke med et standalone læse-script.
`migration/src/approval.mjs` og `migration/src/cutover.mjs` kræver en
menneskelig pilotgodkendelse af indhold og adgangsrettigheder og dokumenterer
rollback. `migration/src/permissions.mjs` håndhæver default-deny og
tenantisolation. Rapporten erklærer `measured: false`; den målte migration er
`make migration-live` og er NOT RUN.

### Konsekvenser

- En migration bliver en kontrolleret, afstemt og reversibel proces frem for et
  engangsscript.
- Tabt funktionalitet er synlig før cutover og kan blokere en menneskelig
  beslutning.
- Exit-eksporten kan læses og verificeres af kunden uden platformen.
- En gentaget eller genoptaget import skaber ikke dubletter, og en dubletkonflikt
  kræver et menneske.
- En cutover uden godkendelse eller rollback er ikke mulig.
- Den faktiske måling mod en levende kilde og den menneskelige godkendelse
  kræver ekstern infrastruktur og er ikke en del af den lokale kontrol.

## Relaterede beslutninger

- [ADR-0023 — Fælles adapter-SDK og kandidatvurdering](0023-faelles-adapter-sdk-og-kandidatvurdering.md)
- [ADR-0049 — Sletning, legal hold og gendannelsesregler](0049-sletning-legal-hold-og-gendannelsesregler.md)
- [ADR-0052 — Sikker deduplikering og kontrolleret oprydning](0052-sikker-deduplikering-og-kontrolleret-oprydning.md)
- [ADR-0054 — Kundeportal og kundelivscyklus med én fælles autorisation](0054-portal-og-kundelivscyklus.md)
- [ADR-0069 — CRM med entydigt ejerskab af kundedata](0069-crm-med-entydigt-ejerskab-af-kundedata.md)
