# Enterprise- og brancheprofiler (DKC-036)

**Kode:** [`enterprise/`](../../enterprise)
**Kanonisk katalog:** [`enterprise/packages.json`](../../enterprise/packages.json)
**Kapabilitetsregister:** [`enterprise/capabilities.json`](../../enterprise/capabilities.json)
**Rapport:** [`docs/enterprise/enterprise-package-report.md`](../enterprise/enterprise-package-report.md)
**Backlog:** bølge 6

Enterprise- og branchepakker er **sammensatte, versionerede katalogposter**. De
beskriver, hvordan en branche udvider platformen oven på en af de tre
størrelsesprofiler — uden at forke kontrolplanet og uden at love universel
dækning. En pakke er en planlægnings- og katalogpost, ikke en bestilt
byggeopgave og ikke en fungerende applikation.

## De tre størrelsesprofiler deler sikkerhedskontrakterne

`catalog/profiles/{small-vps,ha-cluster,enterprise-dedicated}.profile.json` har
den samme `securityCore`: `platform-core`, `identity-broker` og
`audit-service`. Pakkerne arver dem og kan ikke fjerne eller erstatte dem.
`enterprise/packages.json` gentager de fire fælles obligatoriske gates fra
[`distribution/acceptance/gate-policy.json`](../../distribution/acceptance/gate-policy.json)
— `security`, `privacy`, `restore` og `role` — med præcis de samme
`requirementRefs`. `enterprise-check` fejler, hvis de tre profiler ikke har den
samme sikkerhedskerne, eller hvis en gate mangler eller er ændret.

## Kapabilitetskrav

Hver pakke erklærer:

- `required`: kapabiliteter der skal være til stede i den valgte closure. En
  kapabilitet, som kataloget endnu ikke udstiller (fx `mes` eller `plm`),
  markeres **ikke** som en skemafejl — den er en ærlig, uafklaret afhængighed og
  blokerer pakken gennem resolveren.
- `forbidden`: kapabiliteter der ikke må være til stede.
- `controlPlane`: hvilke kontrolplans-kapabiliteter pakken læner sig op ad. De
  skal være udbudt udelukkende af sikkerhedskerne-komponenter og arves fra
  størrelsesprofilen. En pakke, der prøver at udbyde sin egen kontrolplan,
  afvises med `CONTROL_PLANE_FORK`.

`enterprise/capabilities.json` er det kanoniske register. Det valideres mod de
faktiske komponentmanifester, så en kapabilitet ikke kan opfindes i en pakke
uden også at findes i kataloget.

## Pakkens indhold

| Felt | Betydning |
| --- | --- |
| `baseProfileRef` | Størrelsesprofilen pakken bygger på. |
| `apps` | Katalogkomponenter. Sikkerhedskernen må ikke vælges som app. |
| `dataOwnership` | Dataklasse, navngiven ejer, formål, residens og retentionreference. |
| `isolation` | Ekstra isolation: dedikerede databaser, netværkssegmentering, immutable audit. |
| `integrations` | Kandidatprodukter med ærlig `included`/`opt-in`/`unavailable`. |
| `professionalRequirements` | Faglige krav (revisor, lønansvarlig, sektorregel). Ubekræftede krav blokerer. |
| `sectorRules` | Sektorregimer med en særskilt vurdering. |
| `highRiskAi` | Om pakken aktiverer højrisiko-AI, og den særskilte vurdering. |
| `productOwner` | Et navngivet menneske. |
| `testCustomer` | En navngivet testkunde med en navngivet kontakt og en ærlig status. |
| `implementation` | `blocked`/`planned`/`approved`/`ordered` med begrundelse. |
| `tcoRef` | Den dokumenterede TCO-profil fra DKC-034. |
| `exclusions` | Begrundede fravalg. |

## De fem pakker

| # | Pakke | Segment | Basisprofil | Fagligt fokus |
| --- | --- | --- | --- | --- |
| 1 | `enterprise-core` | enterprise | `enterprise-dedicated` | Dansk bogføring, moms, e-faktura, løn |
| 2 | `retail-commerce` | handel | `ha-cluster` | Forbrugerjura, moms, godkendt betalingstjeneste |
| 3 | `field-service` | feltservice | `ha-cluster` | Arbejdsmiljø, persondata på enheder + MES-lignende kapabiliteter |
| 4 | `manufacturing` | produktion | `enterprise-dedicated` | Produkt- og maskinsikkerhed + MES/PLM |
| 5 | `regulated-care` | reguleret | `enterprise-dedicated` | Sektorregler, særlige kategorier, højrisiko-AI |

`field-service` og `manufacturing` er bevidst blokeret af kapabiliteter, som
kataloget endnu ikke udstiller (`field-dispatch`, `offline-sync`, `mes`,
`plm`). Det er den ærlige måde at vise en endnu ikke understøttet branche på.

## Prioritering

`enterprise/src/priority.mjs` prioriterer pakkerne deterministisk efter
efterspørgsel (pilotvirksomhedsprofilerne fra DKC-033 og
virksomhedsprofilerne fra DKC-034) og den dokumenterede 12-måneders TCO
(`metering/report/tco-comparison.json`). Prioriteringen er en
planlægningsrækkefølge — ikke en bestillings- eller implementeringsgodkendelse.

```bash
make enterprise-run        # deterministisk gate-kontrol (viser bl.a. prioriteringsrækkefølgen)
node enterprise/src/cli.mjs priority   # se rækkefølgen direkte
```

## Scaffold

`enterprise/scaffold/package.template.json` og
`enterprise/src/scaffold.mjs` gør det muligt at oprette en ny branchepakke uden
at forke kontrolplanet:

```bash
node enterprise/src/scaffold.mjs new min-branche --out /tmp/min-branche
```

Scaffolden arver de fælles sikkerhedskontrakter fra det kanoniske katalog,
indsætter navngivne ejere, validerer mod skemaet og modellen og skriver først
derefter. Fixtures i `enterprise/fixtures/` demonstrerer konflikterende krav,
ikke-understøttede kapabiliteter, manglende ejere og et forsøg på at gøre en
katalogpost til en byggeopgave.

## Ikke mål

- Faktiske adaptere og produktionsdata.
- En underskrevet testkundeaftale eller en bekræftet faglig/sektor-/AI-vurdering.
- En påstand om, at en pakke er implementerbar.

Alle tre er NOT RUN og kræver et navngivet menneske eller en ekstern kilde. Se
[`docs/operations/enterprise-packages.md`](../operations/enterprise-packages.md)
og [`docs/runbooks/enterprise-package-onboarding.md`](../runbooks/enterprise-package-onboarding.md).
