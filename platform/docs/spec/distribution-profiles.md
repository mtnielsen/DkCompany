# Installationsprofiler og dependency-resolver (DKC-053)

**Kode:** [`distribution/`](../../distribution)
**Katalog:** [`catalog/`](../../catalog)
**Kontrakter:** [`component-manifest.schema.json`](../../contracts/component-manifest.schema.json), [`installation-profile.schema.json`](../../contracts/installation-profile.schema.json), [`platform-matrix.schema.json`](../../contracts/platform-matrix.schema.json)
**Migration:** [`docs/distribution/single-server-til-ha.md`](../distribution/single-server-til-ha.md)
**ADR:** [ADR-0027](../adr/0027-installationsprofiler-og-resolver.md)

## Formål

En installationsprofil skal være en **efterprøvelig plan**, ikke en salgstekst.
En lille VPS, en lokal server og et HA-setup er tre understøttede produkter med
hver sin kontrakt for HA, kapacitet, backup og support. Resolveren svarer på
"hvad installerer jeg, hvorfor, og kan det lade sig gøre?" — og fejler lukket
**før** noget muteres.

## De tre profiler

| Profil | `profileType` | HA | Host-styring | Deployment-profil |
| --- | --- | --- | --- | --- |
| `small-vps` | `single-server` | nej (eksplicit accepteret non-HA) | opt-in | `deployment-profile.smv.example.json` |
| `ha-cluster` | `multiple-servers` | ja (≥3 fejldomæner, N+1) | opt-in | `deployment-profile.service.example.json` |
| `enterprise-dedicated` | `dedicated-customer` | ja | opt-in | `deployment-profile.enterprise.example.json` |

Sikkerhedskernen er **obligatorisk i alle tre**: `platform-core`,
`identity-broker` og `audit-service`. Communications, HR, BI og Reporting er
**valgfrie** applikationer. Host-styring er altid `optIn: true` og kan ikke
fravælges implicit af en profil.

## Komponentmanifestet

Hvert komponentmanifest er versioneret og bærer:

| Felt | Betydning |
| --- | --- |
| `metadata.version` | SemVer for denne komponentversion |
| `componentType` | `security-core`, `technical`, `application`, `data-service`, `host-management`, `integration` |
| `category` | `security`, `platform`, `data`, `communications`, `hr`, `bi`, `reporting`, … |
| `securityCore` | Sand for den obligatoriske kerne |
| `provides.capabilities` / `provides.dataServices` | Hvad komponenten leverer |
| `requires` / `optionalRequires` | Krævede/valgfrie afhængigheder med `range` og `reason` |
| `conflicts` | Komponenter der ikke må installeres samtidigt |
| `dataServices` | Datatjenester komponenten har brug for |
| `migrations` | Faser `pre`, `schema`, `data`, `post` |
| `resources` | CPU, hukommelse, lager, knuder |
| `download` | Artefakter, størrelse, kilde og om de er verificerede |
| `operations` | Driftskrav (ops-verber) |
| `supportProfile` | Supporttier og -vindue |
| `platforms` | Understøttede OS/arkitektur/runtime |
| `implementation.status` | `implemented`, `catalog-only` eller `external` |

En `catalog-only`-komponent må ikke fremstilles som implementeret, og en
`implemented`-komponent skal pege på sit modul. En uverificeret download afvises.

## Resolveren

```bash
node distribution/src/preview.mjs --profile small-vps --apps bi
node distribution/src/preview.mjs --profile ha-cluster --apps bi,hr --json
node distribution/src/check.mjs
```

Resolveren er en ren funktion over kataloget. Den:

1. medtager den obligatoriske sikkerhedskerne og profilens applikationer,
2. samler transitive `requires` (og valgte `optionalRequires`) med en begrundelse
   pr. kant,
3. vælger for hver komponent den **højeste version der opfylder alle krav**,
4. rapporterer alle fejl **før** mutation:

| Kode | Betydning |
| --- | --- |
| `SECURITY_CORE_MISSING` | Profilen udelader en obligatorisk kernekomponent |
| `INCOMPATIBLE_VERSION` | Ingen version opfylder alle versionsintervaller |
| `CYCLE` | Cyklisk afhængighed |
| `CONFLICT` | To valgte komponenter er i konflikt |
| `REMOVED_SHARED_DEPENDENCY` | En delt afhængighed fjernes mens andre kræver den |
| `INSUFFICIENT_RESOURCES` | Closureen overskrider profilens kapacitetsbudget |
| `MISSING_DATA_SERVICE_PROVIDER` | En påkrævet datatjeneste har ingen provider |
| `PROFILE_TYPE_MISMATCH` | Profil og deployment-profil er uenige om `profileType` |
| `SINGLE_SERVER_HA` | Single-server med en HA-deployment-profil |
| `NON_HA_NOT_ACCEPTED` | Single-server uden eksplicit non-HA-accept |
| `EXTERNAL_BACKUP_*` | Single-server uden ekstern, tenantbundet backup |
| `SERVICE_CLASS_PROFILE_MISMATCH` / `SINGLE_SERVER_HA_CLASS` / `HA_CLASS_NOT_ELIGIBLE` | Serviceklasse og profil passer ikke sammen |

Determinismen er en del af kontrakten: samme katalog, profil og valg giver
samme preview. Det er efterprøvet i `distribution/test/resolver.test.mjs`.

## Platformmatrix

`catalog/platforms.json` navngiver hver understøttet kombination, fx
`linux-amd64-node22` og `linux-arm64-node22`, med supporttier og en
`testCommand`. En kombination uden testkommando afvises af
`make distribution-check`. Den kørende maskine slås op med
`currentPlatformId()`.

## Single-server: non-HA med eksplicit accept

`small-vps` er en understøttet produktionsprofil, men den er **ikke HA**. Den må
kun bruges når:

- profilen eksplicit har accepteret en non-HA-serviceklasse
  (`acceptedNonHaServiceClass: true`),
- backup er ekstern, offsite og tenantbundet
  (`externalBackupRequired: true` og en `backup-destination` i
  deployment-profilen),
- de involverede serviceklasser er non-HA, har `acceptedDowntime: true` og
  ekstern/offsite backup.

Ellers afviser resolveren planen. Se også
[`docs/continuity/bia.md`](../continuity/bia.md) og
[ADR-0026](../adr/0026-fejlomraader-n-plus-1-og-recovery.md).

## Test og kontrol

| Kommando | Dækning |
| --- | --- |
| `make distribution-check` | Skema + semantik for katalog, profiler, platformmatrix og resolver |
| `make distribution-test` | SemVer, resolver (cyklus, version, konflikt, fjernet delt afhængighed, ressourcer) og BI-only |
| `make distribution-preview PROFILE=… APPS=…` | Deterministisk installationspreview |

Et grønt preview er **ikke** en gennemført installation. Det er en plan, og
faktiske data skrives først efter en grøn plan og menneskelig godkendelse.
