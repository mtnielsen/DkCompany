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
