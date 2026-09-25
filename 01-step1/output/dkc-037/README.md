# DKC-037 — Implementér serviceklasser og recoverymål (leverance)

Implementering af **DKC-037** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055 og DKC-012. `00-core/` er fortsat **ikke ændret**;
alt ligger under `01-step1/output/dkc-037/`.

## Forudsætninger og valg

DKC-037 afhænger formelt af **DKC-002** (arkitektur- og identitetskontrakter med
deployment-profiler). Den lægges oven på hele den nuværende stak via
`dkc-012/apply.sh`, som kæder `dkc-013/apply.sh` og dermed DKC-001 .. DKC-013 +
DKC-055. **DKC-012 er valgt som forudsætning, fordi den er den aktuelle
stak-top.** DKC-002's eksisterende `deployment-profile.schema.json` og
`architecture.mjs` er bevaret uændret; DKC-037 tilføjer en ny kontrakt og en
semantisk validator ved siden af.

## Hvad der er implementeret

1. **Serviceklassekontrakt.** `contracts/service-class.schema.json` beskriver
   holdbarheds-/fejlmodel, adfærd ved netværkspartition, korruptionsdetektion,
   tilgængelighed, **tre adskilte RPO-mål** (bekræftede writes, regionsnedbrud,
   korruption), RTO, restore-rækkefølge og tilladte/forbudte healinghandlinger,
   replikaer, `statefulMode`, `storageClass`, consistency, backup samt
   kompatibilitet med deployment-profiler. `contracts/module-manifest.schema.json`
   får et `serviceClassRef`, så et modul eksplicit peger på sin serviceklasse.
2. **Semantisk validator.** `conformance/src/service-classes.mjs` afviser
   bl.a. HA uden tre failure domains/N+1/recovery-lokation, single-server med
   HA-badge, flere aktive skrivere uden upstream-understøttelse, et
   regionsnedbrud med strammere RPO end bekræftede writes, sammenlagte
   holdbarhedsmål og en `accepted` klasse uden målt evidens. Validatoren bruges
   både af `make validate` og af continuity-modulet.
3. **Serviceklasser pr. pilotmodul.** `continuity/service-classes/` har én fil
   pr. pilotmodul (`dummy-ok`, `audit-service`, `mattermost-adapter`,
   `keycloak-adapter`) med eksplicit netværkspartition. `audit-service` er
   HA-egnet; de øvrige er non-HA single-server.
4. **Recovery-rapportering.** `continuity/src/recovery.mjs` forbinder de
   validerede mål med faktiske prober. Et mål i konfigurationen er kun
   `declared-only`, indtil der findes en frisk probe; `haBadge` kræver en
   vedtaget forpligtelse og en frisk failover-måling. `make continuity-report`
   skriver markdown/JSON.
5. **Profilkompatibilitet.** `continuity/src/profile-check.mjs` krydser
   serviceklasserne med `deployment-profile.*.example.json`: en HA-profil
   kræver HA-egnede klasser, en non-HA-profil må ikke bruge en HA-egnet klasse.
6. **BIA, ADR og docs.** `docs/continuity/bia.md` (kritiske brugerflows,
   afhængigheder, dataejere, menneskelig beredskabsejer), `docs/adr/0026-...`
   (≥3 fejldomæner, N+1, særskilt recovery-lokation) og
   `docs/spec/service-classes.md`; indeks og implementation-matrix opdateret.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
Makefile                                        (+ continuity-check/-test/-report, + i ci)
conformance/src/schemas.mjs                     (+ serviceClass-skema-id)
conformance/src/service-classes.mjs             (ny: semantisk validator)
conformance/src/validate-schemas.mjs            (+ serviceklasse-validering)
conformance/test/service-class-conformance.test.mjs (ny: 6 accepttests)
conformance/test/fixtures/service-class/*.invalid.json (ny: 2 negative fixtures)
continuity/package.json                         (ny)
continuity/service-classes/*.service-class.json (ny: 4 serviceklasser)
continuity/src/classes.mjs, recovery.mjs, profile-check.mjs, check.mjs, report.mjs (ny)
continuity/test/service-classes.test.mjs, recovery.test.mjs (ny: 21 tests)
contracts/service-class.schema.json             (ny kontrakt)
contracts/examples/service-class.example.json   (ny)
contracts/module-manifest.schema.json           (+ serviceClassRef)
modules/{dummy-ok,audit-service,mattermost-adapter,keycloak-adapter}/module-manifest.json (+ serviceClassRef)
docs/continuity/bia.md                           (ny BIA)
docs/adr/0026-fejlomraader-n-plus-1-og-recovery.md (ny ADR)
docs/adr/README.md, docs/spec/README.md          (opdateret)
docs/spec/service-classes.md                     (ny spec)
docs/status/implementation-matrix.md             (regenereret)
tools/baseline/registry.mjs                      (+ continuity-komponent og 3 checks)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..013 + DKC-012, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make continuity-check` | **OK** (4 serviceklasser, 4 pilotmoduler, 3 deployment-profiler) |
| `make continuity-test` | **27 pass / 0 fail** (21 continuity + 6 konformans-accepttests) |
| `make validate` | **34 skemaer / 33 eksempler** + 1 serviceklasse-eksempel (skema + semantik) |
| `make architecture-check` | **OK** (DKC-002-kontrakterne uændret gyldige) |
| `make architecture-test` | **10 pass / 0 fail** |
| `make test` (conformance) | **101 pass / 0 fail** (inkl. 6 nye DKC-037-accepttests) |
| `make lint` | **OK** (211 JSON-filer, 546 filer) |
| `make observability-check` | **OK** (module-manifest-ændringen er additiv) |
| `make gitops-verify` | **OK** (9/9) |
| `make agent-conformance-test` | **OK** |
| `make tenant-test` | **OK** |
| `make persistence-test` | **47 pass / 0 fail** |
| `make runtime-test` | **86 pass / 0 fail** |
| `make gateway-test` | **28 pass / 0 fail** |
| `make baseline` | **62 pass, 1 fail (DCO), 0 error, 10 not run af 73**; både `continuity-check` og `continuity-test` **PASS** |

`make baseline`'s ene fejl er DKC-001's kendte `changelog-check` (4 commits
mangler DCO sign-off). Baselinekørslen ændrede 30 committede fixture-filer under
`modules/*/conformance`; de er nulstillet med
`git checkout -- modules/*/conformance` fra `00-core/`.

## Acceptkriterier

| Krav | Status | Bevis |
| --- | --- | --- |
| Alle pilotmoduler har serviceklasse og eksplicit adfærd ved netværkspartition | **PASS** | `continuity/test/service-classes.test.mjs`, `conformance/test/service-class-conformance.test.mjs` (2), `continuity/service-classes/` |
| Single-server er en understøttet non-HA-produktionsprofil med accepteret nedetid og ekstern backup; kan ikke få HA-badge | **PASS** | `service-class-conformance.test.mjs` (4), `service-classes.test.mjs` (single-server + HA, acceptedDowntime), `recovery.test.mjs` (HA-badge kræver frisk failover) |
| Mål for bekræftede writes, regionsnedbrud og korruption er adskilt | **PASS** | `service-classes.test.mjs` (identiske mål og enkelt RPO afvises; regionsnedbrud vs. bekræftede writes), schemaets tre `durabilityTarget` |
| Ingen antagelse om at alle upstream-apps kan køre flere aktive skrivere | **PASS** | `service-classes.test.mjs` (`upstreamSupportsMultiWriter`), `service-class.multiwriter.invalid.json`, alle pilotklasser er `single-writer` |
| Menneskelig ejer vedtager mål før produktionsfrigivelse | **PASS (mekanisme)** | `service-classes.test.mjs` (`accepted` uden målt evidens afvises; `proposed` må ikke fremstilles som vedtaget), `recovery.mjs` (`productionReady` kræver `accepted`) |

## Resterende begrænsninger

- **Ingen levende prober eller fejltests.** `integration-continuity-measurement`
  er **NOT RUN**: målene er kontraktvaliderede, men et erklæret niveau er ikke et
  målt niveau. HA-badgen er derfor `false` for alle klasser indtil friske
  failover-/availability-prober findes.
- **To pilotklasser er `proposed`.** `mattermost-adapter` og `keycloak-adapter`
  afventer at et navngivet menneske vedtager målene; indtil da er de ikke
  produktionsklare (det er håndhævet, ikke blot dokumenteret).
- **Tre failure domains er et minimum, ikke en måling.** ADR-0026 fastlægger
  antallet; den faktiske klynge med tre domæner og en særskilt recovery-lokation
  er en drifts-/integrationsopgave (NOT RUN).
- **BIA'en er et levende dokument.** Den skal revurderes årligt og ved ændringer;
  det er en menneskelig proces.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-011, DKC-013, DKC-055 og DKC-012
  (lægges via `apply.sh`, som kæder `dkc-012/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-037/` (33 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`; 18 evidensfiler).
- Uafhængig verifikation, levende prober/fejltests og menneskelig
  release-godkendelse er separate handlinger og er **ikke** udført her.
