# ADR-0029: Versioneret dataregister med ejerbesluttet grundlag, formålsbestemt retention og eksplicit tredjelandsvurdering

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), med Bo Bertelsen som stedfortræder
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-019. Platformen kan håndhæve tekniske kontroller, men den kan ikke svare på, hvilke datakategorier en app eller modelroute behandler, hvorfor, på hvilket grundlag, hvor data ligger, hvem der er underleverandør, eller hvornår data slettes. Uden et register bliver databeskyttelse en påstand i prosa, og en manglende aftale eller ejerbeslutning forsvinder i stedet for at blokere.

## Kontekst og problemstilling

- **Behandlinger er spredt.** Modulmanifester, gateway-routes og telemetri
  beskriver hver deres del, men der findes ingen samlet fortegnelse over
  behandlinger (GDPR art. 30).
- **Behandlingsgrundlaget er ikke et teknisk felt.** Koden må ikke gætte et
  grundlag. Det er en ejerbeslutning, der skal kunne spores til et navngivet
  menneske og et tidspunkt.
- **EU-hosting giver falsk tryghed.** Support-, vedligeholds- og
  modelprovidderadgang kan overføre data til et tredjeland, selv når data hostes
  i EU/EEA.
- **Retention skal være formålsbestemt.** En global opbevaringsfrist uden
  kobling til formålet er ikke GDPR art. 5(1)(e).
- **Persondata skal ikke kunne gemmes som godkendt uden aftale.** Manglende
  databehandleraftale eller tredjelandsvurdering skal markeres, ikke antages.

## Beslutningskriterier

- En versioneret kontrakt og en kanonisk registerfil.
- Behandlingsgrundlaget er et ejerbesluttet felt; koden udleder det aldrig.
- Persondataposter uden ejerbeslutning, aftale eller tredjelandsvurdering er
  blockere og kan ikke stå som godkendte.
- Retention er formålsbestemt og versioneret.
- EU-hosting er ikke i sig selv fravær af tredjelandsoverførsel.
- Hvert pilotmodul og hver modelroute har en registerpost med en navngivet ejer.
- Læsning og skrivning er bundet til den verificerede tenant.

## Overvejede muligheder

- **Prosa-fortegnelse i Markdown.** Let at skrive, men ikke efterprøvelig, og
  den driver fra koden.
- **Genbrug af modulmanifesternes `privacy.dataCategories`.** Dækker kun dele af
  behandlingen og har ingen grundlag, aftaler, placering eller retention.
- **Versioneret register med semantisk håndhævelse og holdbar persistens.**
  Kræver vedligeholdelse, men gør hver behandling efterprøvelig og hver blocker
  synlig.

## Beslutning

Vi indfører et versioneret dataregister, håndhævet i
`contracts/data-register.schema.json`, `conformance/src/data-register.mjs`,
`compliance/` og `persistence/`:

1. **Registeret** (`kind: DataRegister`) beskriver pr. post datakategorier,
   formål, behandlingsgrundlag, roller med kontraktreferencer, placering med
   eksplicit tredjelandsvurdering, modtagere, subprocessorer, databærende
   artefakter og en formålsbestemt, versioneret slettefrist.
2. **Behandlingsgrundlaget** er `owner-decided` eller `pending-owner-decision`.
   En uafklaret beslutning må ikke angive en `ground`; koden opfinder den ikke.
3. **Blockeren.** En persondatapost uden ejerbeslutning, dataansvarlig-/
   databehandleraftale eller tredjelandsvurdering er en blocker og må ikke gemmes
   som `approved`. `make data-register-check` og registertjenesten afviser det.
4. **Tredjeland.** `location.thirdCountryTransfer` skal være eksplicit vurderet
   af et navngivet menneske, også når `hostingRegion` er `eu-eea`. `status:
   none` kræver en skriftlig begrundelse.
5. **Retention** er formålsbestemt (`purposeRef` i samme post), versioneret
   (`version`) og godkendt af et navngivet menneske. Et aktivt `hold` blokerer
   sletning.
6. **Persistens.** Registerversioner, poster, retention, subprocessorer og holds
   gemmes holdbart pr. tenant i `persistence/migrations/0007_data_register.sql`.
7. **Autorisation.** Registertjenesten udleder tenanten af den verificerede
   principal; krydskunde-adgang kræver platformrollen og en eksplicit scope.
8. **Dokumentet** `docs/compliance/data-register.md` genereres fra registeret og
   kontrolleres for sync i `make data-register-check`.

Resultatet valideres i `make validate`, `make data-register-check`,
`make data-register-test` og i CI.

## Konsekvenser

- **Positive:** Hver behandling er efterprøvelig, og en manglende aftale eller
  beslutning blokerer i stedet for at forsvinde. Tredjelandsvurderingen er
  eksplicit, og retention er knyttet til formålet.
- **Negative:** Registeret skal vedligeholdes, og en ændring af en slettefrist
  kræver en ny version og en ejergodkendelse.
- **Neutrale:** Registeret er tenant-agnostisk i den kanoniske fil; persistensen
  gemmer en tenant-bundet kopi pr. kunde.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Prosa-fortegnelse | Hurtig at skrive | Ikke efterprøvelig; driver fra koden |
| Genbrug af `privacy.dataCategories` | Ingen ny data | Mangler grundlag, aftaler, placering og retention |
| Versioneret register + håndhævelse | Efterprøveligt, fail-closed, sporbart | Kræver vedligeholdelse og ejerbeslutninger |

## Mere information

- [`docs/spec/data-register.md`](../spec/data-register.md)
- [`docs/compliance/data-register.md`](../compliance/data-register.md)
- [`contracts/data-register.schema.json`](../../contracts/data-register.schema.json)
- [`compliance/src/data-register.mjs`](../../compliance/src/data-register.mjs),
  [`compliance/src/register-service.mjs`](../../compliance/src/register-service.mjs)
- [`conformance/src/data-register.mjs`](../../conformance/src/data-register.mjs)
- [`persistence/src/adapters/data-register.mjs`](../../persistence/src/adapters/data-register.mjs)
- [ADR-0009](0009-kontrolmapping-roller.md), [ADR-0017](0017-tenant-kontekst-og-ressource-id.md), [ADR-0019](0019-holdbar-tilstand-og-migrationer.md)
