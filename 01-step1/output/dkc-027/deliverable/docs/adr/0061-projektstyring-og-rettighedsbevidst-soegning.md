# Projektstyring og rettighedsbevidst søgning

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-027 kræver, at opgaver, projektplaner og samarbejde leveres med OpenProject som første kandidat, uden at projektdata lækker på tværs af projekter, tenanter eller til en forældet søge-/AI-projektion.

## Kontekst og problemstilling

Et projektstyringsmodul rummer både persondata (ansvarlige, medlemskaber) og forretningskritisk planlægning. To fejl er særligt farlige: at en projektgæst eller et genbrugt principal-id får adgang til et fremmed projekt, og at en tilbagekaldt rettighed fortsat besvares af et cachet søge-/AI-indeks. Samtidig kræver import/eksport en stabil reference, så en gentaget import ikke skaber dubletter, og backup/restore skal erklæres ærligt, fordi det ligger uden for API'et.

## Beslutningskriterier

- Default-deny projekttilgang; et dækkende medlemskab i samme tenant kræves.
- En projektgæst ser kun sit eget projekt.
- Kun et verificeret menneske må ændre medlemskaber og eksportere.
- Import/eksport med stabil externalId og idempotens ved retry.
- Hver rettighedsændring skubber en ny ACL-bevidst søge-/AI-projektion; retrieval afviser en forældet projektion.
- Sletning blokeres af legal hold/retention og rapporterer resterende kopier.
- Backup/restore og editioners featuredækning erklæres ærligt.

## Overvejede muligheder

- **A:** Eksponér OpenProject direkte og læg adgangskontrol i upstreams egne projektroller.
- **B:** En adapter bag den fælles adapter-SDK med en default-deny projektbeslutning og en versionsstyret rettighedsprojektion foran søgning/AI.
- **C:** Synkronisér alt projektindhold ind i platformens egen database og læg kontrollen der.

## Beslutning

Vi vælger **B**. `modules/openproject-adapter/` wrapper OpenProject uændret og oversætter projekter, arbejdspakker, medlemskaber, afhængigheder og statushændelser til en stabil platformskontrakt. `decideProjectAccess` er default-deny og kræver et dækkende medlemskab i samme tenant; `projectRole` filtrerer medlemskaber på projekt, så et medlemskab i ét projekt ikke giver adgang til et andet. Import/eksport bruger `ProjectBundle` med stabil externalId og en kanonisk importplan. `buildPermissionProjection` versioneres ved hver medlemskabsændring, og `isProjectionFresh` afviser en forældet projektion, før AI/søgning svarer. Projektdata er autoritative i upstream; tenantreference, audit, DSAR, søgeprojektion og sletterkvittering er autoritative i platformen.

### Konsekvenser

- **Positive:** Ingen projekttilgang uden medlemskab; gæster isoleres; rettighedsændringer slår igennem før retrieval; import er idempotent; backup/restore lyver ikke.
- **Negative:** Upstreams egne roller oversættes til platformens rollematrix; en ny rolle kræver en opdateret mapping og test.
- **Neutrale:** OpenProject forbliver system-of-record for projektindhold; adapteren tilføjer kun en rettigheds- og udvekslingskontrakt.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen oversættelse | Upstream-roller lækker på tværs af platformens tenant- og AI-grænse |
| B | Default-deny, versionsstyret projektion, idempotent import | Mere formel; kræver vedligeholdt rolle- og feltmapping |
| C | Fuld kontrol i platformen | Dubleret system-of-record; synkroniseringsfejl og datadrift |

## Mere information

- [`docs/spec/openproject-adapter.md`](../spec/openproject-adapter.md), [`docs/runbooks/project-management.md`](../runbooks/project-management.md)
- [`contracts/project-export.schema.json`](../../contracts/project-export.schema.json)
- DKC-011 (værktøjsgrænse), DKC-021 (sletning/retention), DKC-023 (fælles adapter-SDK), DKC-025 (portal)
