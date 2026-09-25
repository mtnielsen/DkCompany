# Compliance: NIS2, GDPR og AI Act

**Kode:** [`compliance/`](../../compliance)
**Kanonisk mapping:** [`compliance/control-mapping.json`](../../compliance/control-mapping.json)
**Genereret tabel:** [`mapping.md`](mapping.md)
**Backlog:** 3.2

> Dette repo er ikke «compliant software».

Platformen består af kontrakter, en konformanssuite og evidensmaskineri. Den gør en organisation i stand til at **dokumentere og håndhæve** sine tekniske kontroller og til at give en revisor maskinlæsbar evidens. Den gør ikke organisationen compliant, og den bærer ikke det juridiske ansvar. Det gør den, der deployer og driver platformen.

## Udgiver og deployer

| Rolle | Hvem | Hvad |
| --- | --- | --- |
| **Udgiver** | Platformen (dette repo) | Stiller mekanismen til rådighed og beviser den i CI: kontrakter, konformanstests, signerede policy-bundles, audit-log og OSCAL-evidens. |
| **Deployer** | Den ansvarlige organisation | Konfigurerer, driver og overvåger mekanismen for sine egne systemer, fører tilsyn og indberetter hændelser. Bærer det juridiske ansvar. |
| **Delt** | Begge | Platformen leverer mekanismen; den virker kun, hvis deployer aktiverer den og reagerer på signalerne. |

Skillet er ikke en ansvarsfraskrivelse, men en præcisering: en signeret policy-bundle er ikke det samme som en gennemført adgangspolitik. NIS2 art. 21 og AI Act art. 14 lægger pligter på begge sider af den grænse.

## Frameworks

| Framework | Dækning | Eksempler på krav |
| --- | --- | --- |
| **NIS2** | Art. 21(2) a–j og art. 23 | Risikoanalyse, hændelser, kontinuitet, forsyningskæde, sårbarheder, kryptografi, adgangskontrol, MFA, indberetning |
| **GDPR** | Art. 5–35 | Principper, registreredes rettigheder, privacy by design, fortegnelse, sikkerhed, brud, DPIA |
| **AI Act** | Art. 9–15 | Risikostyring, logning, transparens, menneskeligt tilsyn, robusthed |

Den fulde tabel med hvert krav og hver kontrol findes i [`mapping.md`](mapping.md). Den genereres fra den kanoniske registry:

```bash
make compliance-mapping   # genskab docs/compliance/mapping.md
make compliance-check     # fejl hvis docs er ude af trit med registry
make compliance-test      # validering, krydsreferencer og driftstest
```

Modulernes `compliance.controlRefs` skal findes i registry; konformanstjekket `C-012` håndhæver det. OSCAL-evidenspakken fra 3.1 bærer de samme kontrol-id'er i `reviewed-controls`.

## Dataregister og retention (DKC-019)

Kontrolmappingen siger, hvilke regulatoriske krav mekanismerne tjener. Den siger
ikke, hvilke datakategorier en app eller modelroute behandler, på hvilket
grundlag, hvor data ligger, hvem der er underleverandør, eller hvornår data
slettes. Det gør [`data-register.json`](../../compliance/data-register.json), hvis
genererede tabel er [`data-register.md`](data-register.md):

```bash
make data-register-write   # genskab docs/compliance/data-register.md
make data-register-check   # fejl hvis registeret er ude af trit eller mangler ejer/aftale/vurdering
make data-register-test    # blocker, retention, holds og tenantautorisation
```

Behandlingsgrundlaget er et **ejerbesluttet** felt, og en manglende beslutning
eller aftale er en blocker for persondata — ikke en antagelse. EU-hosting er
ikke i sig selv fravær af tredjelandsoverførsel. Se
[`docs/spec/data-register.md`](../spec/data-register.md) og
[ADR-0029](../adr/0029-dataregister-og-retention.md).

## Beskyttede dataklasser (DKC-047)

Dataregisteret siger, hvilke data der behandles. Det siger ikke, om en AI må
ændre, opbevare eller læse dem. Det gør
[`data-protection/records/register.json`](../../data-protection/records/register.json),
hvis genererede tabel er [`protected-data.md`](protected-data.md):

```bash
make data-protection-write   # genskab docs/compliance/protected-data.md
make data-protection-check   # validér forbud, modul-dækning og ærlig lagerhåndhævelse
make data-protection-test    # guard, transitioner og runtimehåndhævelse
```

AI-ændringsforbud, WORM-retention og no-AI-access er tre adskilte regler. Fuld
fysisk lager-/nøglehåndhævelse er leveret af DKC-048 og dokumenteret i
[`immutable-storage.md`](immutable-storage.md): object-lock i GOVERNANCE og
COMPLIANCE, en rollematrix der nægter AI og app-konti alle muterende
operationer, append-only audit-ingest, beskyttet KMS-nøglebutik og
to-personers kontrol. Se [`docs/spec/data-protection.md`](../spec/data-protection.md),
[`docs/spec/immutable-enforcement.md`](../spec/immutable-enforcement.md) og
[ADR-0030](../adr/0030-ai-immutable-dataklasser.md)/[ADR-0048](../adr/0048-immutable-data-uden-for-agentens-kontrol.md).

## Sletningsdækning og legal hold (DKC-021)

Dataregisteret og beskyttelsesregisteret siger, hvilke data der behandles, og
hvordan de beskyttes. De siger ikke, hvordan en sletning faktisk gennemføres på
tværs af primærlager, indeks, cache, afledte AI-data og backups. Det gør
[`retention/deletion-policy.json`](../../retention/deletion-policy.json), hvis
genererede tabel er [`deletion-coverage.md`](deletion-coverage.md):

```bash
make retention-write   # genskab docs/compliance/deletion-coverage.md
make retention-check   # validér dækning, holds og genanvendelse ved restore
make retention-test    # sletning, hold, kvitteringer, restoregate og persistens
make retention-demo    # et fuldt gennemløb på den rigtige stak
```

Et hold kræver en dokumenteret begrundelse og en **separat** godkender, og det
blokerer enhver sletning i sin scope. En flade der ikke kan slette fysisk
rapporteres ærligt som `partial`/`unsupported` med resterende kopier og udløb.
En gendannelse forbliver i karantæne og genanvender slettebeslutninger, før
miljøet frigives. Se [`docs/spec/retention-deletion.md`](../spec/retention-deletion.md),
[`docs/runbooks/deletion-legal-hold.md`](../runbooks/deletion-legal-hold.md) og
[ADR-0049](../adr/0049-sletning-legal-hold-og-gendannelsesregler.md).

## Evidens- og risikoregister (DKC-022)

Kontrolmappingen, dataregisteret, beskyttelsesregisteret og sletningspolitikken
beskriver hver sit lag. De knytter ikke krav til faktiske kontroller, ansvarlige
personer og verificeret evidens — og de gør ikke åbne juridiske beslutninger
synlige. Det gør [`assurance-register.json`](../../compliance/assurance-register.json),
hvis genererede tabel er [`assurance.md`](assurance.md):

```bash
make assurance-write    # genskab docs/compliance/assurance.md
make assurance-check    # validér register, krydsreferencer og dokumentsync
make assurance-test     # register, evidenspakke, friskhed/binding, accept og journal
make assurance-export   # saml evidence/generated/assurance-package.json
```

Hvert krav har kilde, dato, ansvarlig, status, kontrolreference og evidenslink.
En udestående DPIA, overførselsvurdering eller åben beslutning er eksplicit
blokerende for en pilot med persondata. Evidenspakken afviser udløbet,
forkert-bundet og manuelt ændret evidens og skelner automatiseret evidens,
manglende vurderinger og menneskelige beslutninger. Et badge er ikke en
certificering, og en eksport erklærer aldrig platformen compliant. Se
[`docs/spec/assurance.md`](../spec/assurance.md),
[`docs/compliance/dpia-and-transfers.md`](dpia-and-transfers.md),
[`docs/compliance/incident-access-exit.md`](incident-access-exit.md) og
[ADR-0053](../adr/0053-evidens-og-risikoregister.md).
