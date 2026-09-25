# Dataregister og retention

**Kode:** [`compliance/`](../../compliance), [`persistence/`](../../persistence)
**Kontrakt:** [`contracts/data-register.schema.json`](../../contracts/data-register.schema.json)
**Tabel:** [`docs/compliance/data-register.md`](../compliance/data-register.md)
**Beslutning:** [ADR-0029](../adr/0029-dataregister-og-retention.md) · **Backlog:** DKC-019

> Gør databeskyttelseskrav konkrete for hver app og modelroute — og marker det,
> der ikke er besluttet, som en blocker i stedet for at antage det.

## Formål

Konformanssuitten ved, om et modul eller en route overholder platformens
tekniske kontrakter. Den ved ikke, hvilke **datakategorier** der behandles,
hvilket **formål** behandlingen tjener, hvilket **behandlingsgrundlag** der
gælder, hvor data ligger, hvem der er **modtagere** og **subprocessorer**, eller
hvornår data skal **slettes**. DKC-019 lukker hullet med et versioneret
dataregister, der er den kanoniske kilde for alle behandlinger.

Registeret dækker pr. post:

- datakategorier og formål,
- behandlingsgrundlag som et **ejerbesluttet felt** (koden udleder det aldrig),
- dataansvarlig-/databehandlerrolle med kontraktreferencer,
- placering og en **eksplicit tredjelandsvurdering**,
- modtagere og subprocessorer med aftaler,
- en formålsbestemt, versioneret slettefrist og et aktivt slette-stop (hold),
- prompts, embeddings, supportadgang, logs, backups og modelproviderens
  databrug.

## Kanonisk kilde og genereret tabel

```text
compliance/data-register.json ──render──▶ docs/compliance/data-register.md
        │
        ├── valideres mod contracts/data-register.schema.json
        ├── semantik: ejer, blocker, retention, tredjeland (conformance/src/data-register.mjs)
        ├── krydsrefereres mod modules/ og gateway/routes.json
        └── gemmes versioneret pr. tenant i persistence/
```

`make data-register-check` fejler, hvis den genererede fil er ude af trit, hvis
en post mangler en ejer, eller hvis persondata ikke er dækket.

## Blocker frem for antagelse

Behandlingsgrundlaget er et **ejerbesluttet** felt. Koden opfinder det aldrig.
En persondatapost uden ejerbeslutning, databehandleraftale eller
tredjelandsvurdering er en **blocker** og må ikke stå som `approved`:

| Felt | Krav for persondata |
| --- | --- |
| `legalBasis.status` | `owner-decided` med en konkret `ground`, et navngivet menneske og et tidspunkt |
| `roles.controller.contractRef` | dataansvarlig-aftale |
| `roles.processor.contractRef` | databehandleraftale |
| `location.thirdCountryTransfer.assessed` | eksplicit vurdering af et navngivet menneske |
| `assets` | prompts, embeddings, supportadgang, logs, backups og modelproviders databrug |

## EU-hosting er ikke fravær af tredjelandsoverførsel

Et EU-hostet datasæt kan stadig overføres til et tredjeland gennem support-,
vedligeholds- eller modelprovidderadgang. Vurderingen er derfor **eksplicit**:
`location.thirdCountryTransfer` skal have `assessed: true`, `assessedBy`,
`assessedAt` og en `status` (`none`, `present` eller `undetermined`). Status
`none` kræver en skriftlig begrundelse. Den semantiske validator afviser en
manglende vurdering, også når `hostingRegion` er `eu-eea`.

## Retention

Slettefristen ligger i posten (`retention`) og er:

- **formålsbestemt**: `purposeRef` skal pege på et formål i samme post,
- **versioneret**: `version` ændres, når fristen ændres,
- **godkendt**: `approvedBy` er et navngivet menneske.

Et aktivt `hold` (fx verserende retssag) blokerer sletning, indtil det frigives
af et navngivet menneske. Holds og registerversioner gemmes holdbart pr. tenant.

## Tenantautorisation

Registertjenesten (`compliance/src/register-service.mjs`) udleder tenanten af
den verificerede principal. Krydskunde-adgang kræver platformrollen
(`platform-admin`) **og** en eksplicit scope. Persistenslaget er tenant-bundet
og filtrerer eksplicit på `tenant_id`; en fremmed tenant får hverken læsning
eller skrivning.

## Sådan håndhæves det

```bash
make data-register-write   # genskab docs/compliance/data-register.md
make data-register-check   # fejl hvis dokumentet er ude af trit, eller hvis en post mangler ejer/aftale/vurdering
make data-register-test    # validering, blocker, retention, holds og tenantautorisation
```

## Acceptkriterier (DKC-019)

- [x] Alle pilotmoduler og routes har en registerpost med ejer; persondataposter er godkendte eller eksplicit blokerede.
- [x] Manglende beslutning eller aftale markeres som blocker for persondata.
- [x] Retention er formålsbestemt og versioneret.
- [x] EU-hosting markeres ikke automatisk som fravær af tredjelandsoverførsel.

## Grænser

- Registeret er en påstand om mekanismer, ikke en juridisk vurdering. De
  syntetiske ejerbeslutninger i dette reference-repo erstatter ikke en rigtig
  DPO- eller ledelsesbeslutning.
- Der er ingen kørende HTTP-API i repoet; tjenestelaget er den kaldeflade,
  som en API-grænse skal bruge, og tenantautorisationen er efterprøvet i tests.
