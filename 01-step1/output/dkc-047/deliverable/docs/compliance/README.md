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
fysisk lager-/nøglehåndhævelse leveres af DKC-048 og erklæres ærligt som
manglende indtil da. Se [`docs/spec/data-protection.md`](../spec/data-protection.md)
og [ADR-0030](../adr/0030-ai-immutable-dataklasser.md).
