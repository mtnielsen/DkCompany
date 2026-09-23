# ADR-0008: OSCAL-assessment-results som evidensformat

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** En revisor skal kunne modtage maskinlæsbar evidens uden at lære et hjemmestrikket format — og uden at vi påstår mere, end artefakterne viser.

## Kontekst og problemstilling

Platformen producerer allerede rigelige beviser: konformansrapporter, signerede policy-beslutninger, hash-kædede audit-hændelser, en komplet git-historik og GitOps-gate-resultater. De ligger spredt i forskellige filformater og er kun læsbare for den, der kender repoet. 3.1 kræver, at de samles til evidens for de kontroller, modulerne påstår at opfylde.

Spørgsmålet er, hvilket format evidenspakken skal have. Et eget JSON-format er nemt, men tvinger en revisor til at lære endnu et format. Fuldt OSCAL er standarden, men stort, komplekst og kræver tunge afhængigheder at validere.

## Beslutningskriterier

- En revisor skal kunne læse pakken med standardværktøjer.
- Pakken skal genereres maskinelt fra eksisterende artefakter, ikke skrives i hånden.
- Formen skal kunne håndhæves i CI med de afhængigheder, monorepoet allerede har.
- Et tjek, der ikke kunne afgøres, må ikke fremstå som bestået.
- Valget skal være muligt at udvide (kataloger, SSP) uden at kassere pakken.

## Overvejede muligheder

- **Eget JSON-evidensformat.** Nemt at bygge, men ingen genkendelighed, og vi skal selv vedligeholde et standardsprog.
- **Fuld OSCAL med et bibliotek.** Fuld dækning, men trækker tunge afhængigheder ind og løser problemer, vi ikke har.
- **En afgrænset OSCAL-profil uden runtime-afhængigheder.** Standardens navne og struktur, kun de felter vi kan udfylde, valideret af vores egen kontrakt. Vores valg.
- **PDF/Word-rapport.** Læsbar for mennesker, ubrugelig for maskiner og umulig at diffe.

## Beslutning

1. Evidenspakken er en OSCAL 1.1 `assessment-results`-profil. Feltnavne og struktur følger OSCALs kebab-case; `contracts/oscal-assessment-results.schema.json` er den kontrakt, CI håndhæver.
2. `evidence/` emitterer pakken uden runtime-afhængigheder. Indsamling (`collect.mjs`) er adskilt fra opbygning (`oscal.mjs`), så testene kan køre på kendte artefakter.
3. Et tjek mapper til `satisfied` ved `pass` og til `not-satisfied` ved alt andet — også `skip` — med den rå begrundelse. Vi vælger hellere et konservativt fund end en falsk grøn.
4. Id'er udledes deterministisk fra en SHA-256-hash, så to kørsler kan diffes. Pakken indgår i `make ci` og uploades som CI-artefakt.

## Konsekvenser

- **Positive:** Evidens i et format, en revisor kender. Ingen nye afhængigheder. `skip` bliver synligt som et åbent fund i stedet for at forsvinde. Kortlægningen i 3.2 og sikkerhedsplanen i 3.4 kan bygge direkte på `target-id` og `reviewed-controls`.
- **Negative:** Vi udfylder kun en delmængde af OSCAL; en revisor, der forventer et komplet dokument, skal vide det. Profilen er vores ansvar at holde ved lige, når OSCAL versioneres.
- **Neutrale:** Modulerne skal fortsat levere `compliance.controlRefs` (tjek `C-011`) for at pakken siger noget om kontroller i stedet for kun om tjek.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Eget JSON-format | Hurtigt, ingen standardhensyn | Ingen genkendelighed, egen standard at vedligeholde |
| Fuld OSCAL | Komplet, bredt værktøjsstøtte | Tunge afhængigheder, løser ikke vores problem |
| OSCAL-profil | Genkendeligt, afhængighedsfrit, håndhævbart i CI | Delmængde, kræver dokumentation |
| PDF/Word | Menneskevenligt | Ikke maskinlæsbart, ikke diffbart |

## Mere information

- [`docs/spec/oscal-evidence.md`](../spec/oscal-evidence.md)
- [`contracts/oscal-assessment-results.schema.json`](../../contracts/oscal-assessment-results.schema.json)
- [ADR-0003](0003-partial-conformance.md), [ADR-0007](0007-evidens-og-prosa-adskilt.md)
