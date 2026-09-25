# Automatiseret fejl- og katastrofematrix

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-09-28
- **Beslutningsdrev:** DKC-051 kræver, at platformens adfærd ved samtidige fejl og kompromitterede agentrettigheder bevises, ikke antages.

## Kontekst og problemstilling

Platformen har HA, databasefailover, holdbar beskedsudveksling, holdbart lager, dedup, immutable data og begrænset selvreparation. Hver komponent er testet for sig, men en samtidig fejl kan ramme flere på én gang, og en kompromitteret agent kan forsøge at omgå immutable-grænsen. Uden en gentagelig fejlmatrix kan et design se robust ud, mens en kombination af hosttab, quorumtab og en healingstorm efterlader platformen uden en autoritativ skriver eller taber kvitterede writes.

## Beslutningskriterier

- Fejlmatrixen skal dække hosttab, quorumtab, partition, databasefailover, diskfuld, korruption, kø-replay og tab af kontroltjenester.
- Den skal desuden dække restore til andet site, dedup-prune, KMS-utilgængelighed og bypassforsøg mod AI-immutable.
- Hvert scenarie angiver failure scope, forventet dataudfald, RPO/RTO og tilladt autonomi.
- Ingen split-brain og intet tab af kvitterede kritiske writes i den vedtagne fejlmodel.
- Katastrofegendannelse opfylder målene eller blokerer release med en afvigelsesrapport.
- En healingstorm stoppes af et fælles budget og menneskelig eskalation.
- Alle immutable-bypassforsøg afvises og logges.
- Øvelsen kan gentages fra en ren installation uden kundedata.

## Overvejede muligheder

- **A:** Manuelle fejløvelser dokumenteret i et regneark.
- **B:** En versioneret, deterministisk fejlmatrix der kører de rigtige moduler med syntetiske data, opgør invarianterne og blokerer release ved afvigelser; en målt øvelse på levende staging er en ekstern integration.
- **C:** Kun komponentvise tests og ingen samtidig fejlmodel.

## Beslutning

Vi vælger **B**. `chaos/failure-matrix.json` erklærer 13 scenarier med failure scope, dataudfald, RPO/RTO og autonomi. `chaos/src/probes.mjs` kører de rigtige moduler — HA-quorum, databasefailover med fencing, lager-scrub/quorum, outbox/inbox, dedup-prune, DR-restore, den immutable-håndhævede WORM-butik og remediation-budgettet. `chaos/src/runner.mjs` sammenligner det målte med det erklærede, opgør de fem invarianter og udleder en gate: enhver afvigelse blokerer release med en rapport. Resultatet bærer `measured: false`; den levende øvelse er `make chaos-live` og er NOT RUN.

### Konsekvenser

- **Positive:** Kombinerede fejl og kompromitterede agenter efterprøves gentageligt; en afvigelse blokerer release; immutable-bypass og healingstorme er målbart afvist.
- **Negative:** Matrixen skal vedligeholdes, når et modul eller en fejlmodel ændres, og en målt øvelse mangler stadig.
- **Neutrale:** Chaos er en ny førstepartskomponent uden et modulmanifest; den kører kun de eksisterende moduler.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen kode | Ikke gentagelig; ingen gate; fejl opdages i drift |
| B | Gentagelig, versionsstyret, blokerer release, dækker samtidige fejl | Kræver vedligeholdt matrix og en ekstern måling |
| C | Simpelt | Overser kombinationer; kan ikke blokere release på dataudfald |

## Mere information

- [`docs/spec/chaos.md`](../spec/chaos.md), [`docs/continuity/chaos-report.md`](../continuity/chaos-report.md), [`docs/continuity/chaos-live.md`](../continuity/chaos-live.md)
- [`chaos/failure-matrix.json`](../../chaos/failure-matrix.json), [`contracts/failure-matrix.schema.json`](../../contracts/failure-matrix.schema.json)
- [`docs/adr/0044-ha-klynge-og-sikker-serverkommunikation.md`](0044-ha-klynge-og-sikker-serverkommunikation.md), [`docs/adr/0046-database-ha-med-fencing-og-konsistent-failover.md`](0046-database-ha-med-fencing-og-konsistent-failover.md), [`docs/adr/0048-immutable-data-uden-for-agentens-kontrol.md`](0048-immutable-data-uden-for-agentens-kontrol.md), [`docs/adr/0058-begraenset-selvreparation.md`](0058-begraenset-selvreparation.md)
