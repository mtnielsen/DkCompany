# ADR-0021: Holdbar audit med intent-før-handling og eksternt forankret checkpoint

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-009. Audit-servicen skrev audit-sporet **efter** handlingen, og loggen var in-memory. Et nedbrud mellem handling og log kunne give et falsk success eller en ukritisk genudførelse, og en slettet/trunkeret log kunne ikke påvises, fordi hash-kæden var den eneste forankring og lå samme sted som loggen selv.

## Kontekst og problemstilling

Et audit-spor skal dokumentere **forsøget før** handlingen og **resultatet bagefter**. Den daværende model havde tre huller:

- **Rækkefølgen:** loggen blev skrevet efter handleren. Kunne loggen ikke skrives, var den eksterne ændring allerede sket.
- **Nedbrud:** et crash mellem handling og log gav ingen holdbar intention og dermed intet grundlag for at afgøre, om handlingen var udført.
- **Bevisværdi:** en hash-kæde opdager ændringer, men hvis hele loggen slettes eller trunkeres og genopbygges, verificerer den nye kæde fint. Der manglede en forankring uden for loggen.

Derudover behandlede loggen personhenførbare data og hemmeligheder som alt andet payload.

## Beslutningskriterier

- Audit utilgængelig før handling ⇒ nul eksterne ændringer.
- Crash mellem intent og outcome ⇒ intet falsk success og ingen ukritisk genudførelse.
- Ændring, sletning og trunkering skal kunne påvises mod et eksternt forankret checkpoint.
- Audit skal overleve genstart, og hemmeligheder må aldrig optræde i loggen.
- Persondata skal kunne slettes/udløbe uden at brække hash-kæden.

## Overvejede muligheder

- **Skrive audit før og efter i samme in-memory-log.** Løser ikke holdbarhed.
- **Kun hash-kæde med længde/kontrolsum.** Opdager ikke en fuld omskrivning.
- **To-faset, holdbar intent/outcome med idempotency-ID, eksternt HMAC-forankret checkpoint og adskilte skrive-/læserroller.** Mere maskineri, men lukker alle fire huller.

## Beslutning

1. **To-faset protokol.** `persistence/src/adapters/audit-journal.mjs` skriver og committer et **intent** (med `idempotency_id`) i en `BEGIN IMMEDIATE`-transaktion, før nogen executor kaldes. Først når kvitteringen er holdbar, må handlingen udføres. Bagefter skrives **outcome** bundet til samme idempotency-ID.
2. **Idempotens og reconciliation.** Primærnøglen `(tenant_id, idempotency_id)` gør et gentaget intent til en `duplicate`. Et intent uden outcome er `pending`/`unknown`; runtimen genudfører aldrig, men returnerer `unknown`, og en reconciliation afgør den faktiske tilstand via den eksterne ressource.
3. **Eksternt forankret checkpoint.** `persistence/src/checkpoint.mjs` skriver et HMAC-signeret checkpoint (kædehoved + antal begivenheder) til en **anden** mappe/medie end databasen. `verify` opdager `truncated`, `deleted`, `changed` og `forged`.
4. **Adskilte roller.** `persistence/src/audit-roles.mjs` åbner `audit-writer` (append/intent/outcome/anchor) og `audit-reader` (skrivebeskyttet SELECT/verifikation). I produktion svarer det til separate PostgreSQL-roller med GRANTs.
5. **Minimering og retention.** `persistence/src/redact.mjs` fjerner hemmeligheder på feltnavn og værdimønster. Personhenførbare felter gemmes i `audit_personal` med egen retention; kun digesten indgår i den hash-kædede begivenhed, så en sletning ikke brækker kæden.
6. **Runtime og service er fail-closed.** `runtime/src/runtime.mjs` og `modules/audit-service/service/src/server.mjs` skriver intent før handleren og returnerer `halted`/`unknown` — aldrig success — hvis intent eller outcome ikke kan gøres holdbar.

## Konsekvenser

- **Positive:** Auditsporet er holdbart og beviser forsøget før ændringen. Et crash kan ikke give falsk success. Ændring/sletning/trunkering kan påvises mod et checkpoint uden for databasen. Hemmeligheder og persondata håndteres særskilt.
- **Negative:** Der kommer flere skrivninger pr. handling (intent + outcome + checkpoint). `createAuditService` og `createAgentRuntime` får en valgfri `journal`; uden den bevares den gamle in-memory-adfærd, men den stærke garanti kræver den.
- **Neutrale:** Et nyt `idempotency_id`-felt på `audit_events` og to nye tabeller (`audit_intents`, `audit_personal`) tilføjes i migration v3. Migrationen er additiv og bagudkompatibel.

## Mere information

- [`docs/spec/audit-durability.md`](../spec/audit-durability.md)
- [`persistence/src/adapters/audit-journal.mjs`](../../persistence/src/adapters/audit-journal.mjs), [`persistence/src/checkpoint.mjs`](../../persistence/src/checkpoint.mjs), [`persistence/src/audit-roles.mjs`](../../persistence/src/audit-roles.mjs), [`persistence/src/redact.mjs`](../../persistence/src/redact.mjs)
- [`contracts/audit-intent.schema.json`](../../contracts/audit-intent.schema.json), [`contracts/audit-outcome.schema.json`](../../contracts/audit-outcome.schema.json), [`contracts/audit-checkpoint.schema.json`](../../contracts/audit-checkpoint.schema.json)
- [ADR-0019](0019-holdbar-tilstand-og-migrationer.md), [ADR-0018](0018-stram-policy-scope-og-evidenkontrol.md)
