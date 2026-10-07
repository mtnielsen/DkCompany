# ADR-0049 — Sletning, legal hold og gendannelsesregler

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner, Data Protection Officer
- **Dato:** 2026-09-27
- **Beslutningsdrev:** DKC-021. ADR-0029 indførte et dataregister med formålsbestemt retention og et slette-stop pr. registerpost, ADR-0038 gjorde DSAR til en holdbar, autoriseret sag, ADR-0039/0040 gav krypteret backup og eksterne mål, og ADR-0048 gjorde WORM fysisk. Det mangler at gøre sletning til en **håndhævet** proces på tværs af alle datalag og at sikre, at en gendannelse ikke genindfører slettede persondata.

## Kontekst og problemstilling

En sletning i dag er ikke dækket end-to-end:

- det autoritative objektlager, det genopbyggelige indeks, cachen og de afledte
  AI-data (prompts/embeddings) er separate lag med hver sin levetid,
- et hold på en registerpost blokerer ikke nødvendigvis en sletning i et andet
  lag, og et hold kan mangle en dokumenteret begrundelse og en uafhængig
  godkender,
- en backup er et øjebliksbillede fra **før** sletningen, så en ukontrolleret
  gendannelse genindfører data, nogen har fået slettet,
- et sletteforsøg kan ikke bevises uden at gemme de slettede data, og
- en AI-agent kan i princippet være den der sletter eller omgår et hold.

Retention er en påstand, indtil sletningen faktisk er gennemført — eller dens
manglende dækning er rapporteret ærligt.

## Beslutningskriterier

- Dokumenteret dækning pr. datalag; et lag der ikke kan slette fysisk må ikke
  påstå fuld dækning.
- Et hold kræver begrundelse og en separat, navngivet godkender og blokerer
  enhver sletning i sin scope.
- Slettebeslutninger genanvendes ved restore, før miljøet frigives.
- Sletteforsøg og resultat bevares som et revisionsspor uden de slettede data
  eller rå identifikatorer.
- AI-principaler kan hverken slette eller lægge hold.
- En gendannelse må ikke frigives, mens et aktivt hold dækker et subjekt i
  karantænen.

## Overvejede muligheder

- **A: Slet kun i det autoritative lager og stol på, at afledte lag udløber af
  sig selv.** Enkel, men uærlig: cache, indeks, embeddings og backups kan
  overleve, og en gammel backup kan genindføre data.
- **B: Slet fysisk i alle lag, inkl. WORM-låste backups.** Bryder ADR-0048's
  uforanderlighed og gør et kompromitteret driftscredential i stand til at
  ødelægge bevismateriale.
- **C: En central, autoriseret slette­tjeneste med en erklæret dækning pr. lag,
  begrundede holds, en suppressionsjournal og et restore-gate.** Flere
  komponenter, men hver påstand er efterprøvelig, og WORM bevares.

## Beslutning

Vi vælger **C**. `retention/deletion-policy.json` erklærer de fem obligatoriske
datalag og dækningen for hvert af dem. `retention/src/deletion-service.mjs` er
den ene autoriserede vej:

1. tenant udledes af den verificerede principal; AI-principaler og principaler
   uden slette-/holdrolle afvises (default-deny),
2. aktive holds kontrolleres **før** nogen mutation. Et hold giver
   `blocked-by-hold` uden at slette noget,
3. et revisionsintent med kun subjektets digest og flade-id'er skrives før
   mutationen,
4. hver flade sletter og rapporterer `full`, `partial`, `unsupported` eller
   `not-found` med begrundelse og resterende kopier,
5. backups dækkes af en append-only suppressionsjournal; den WORM-låste kopi
   slettes ikke, men beslutningen genanvendes ved restore, og
6. `retention/src/restore-gate.mjs` holder et gendannet miljø i karantæne, indtil
   alle slettebeslutninger nyere end restorepunktet er genanvendt, journalen
   ikke er vokset siden, og ingen aktivt hold dækker et subjekt i karantænen.

### Konsekvenser

- **Positive:** sletning bliver en efterprøvelig, autoriseret proces; en partial
  dækning rapporteres ærligt; en gendannelse kan ikke genindføre slettede data;
  revisionssporet bærer aldrig de slettede data; WORM bevares.
- **Negative:** en sletning er nu afhængig af en erklæret politik og en
  suppressionsjournal; en manglende journal gør backupfladen `unsupported`.
  Eksterne leverandører uden slette-API forbliver `unsupported` og kræver en
  databehandleraftale.
- **Neutrale:** et hold er nu subjekt-/dataklasse-scopet og supplerer
  registerpost-holdet fra ADR-0029.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Meget enkel | Uærlig dækning; data overlever; restore genindfører data |
| B | Fuld fysisk sletning | Bryder WORM; kompromitteret credential kan ødelægge bevis |
| C | Efterprøvelig, ærlig, bevarer WORM | Flere komponenter og en suppressionsjournal at drifte |

## Mere information

- [ADR-0029 — Versioneret dataregister med formålsbestemt retention](0029-dataregister-og-retention.md)
- [ADR-0038 — Holdbar DSAR-sag og sikret eksport](0038-holdbar-dsar-og-sikret-eksport.md)
- [ADR-0039 — Krypteret backup og gendannelsesøvelse](0039-krypteret-backup-og-gendannelsesoevelse.md)
- [ADR-0048 — Immutable data uden for agentens kontrol](0048-immutable-data-uden-for-agentens-kontrol.md)
- `docs/spec/retention-deletion.md`, `docs/compliance/deletion-coverage.md`, `docs/runbooks/deletion-legal-hold.md`
