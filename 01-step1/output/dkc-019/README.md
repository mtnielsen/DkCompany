# DKC-019 — Dataregister og retentionkonfiguration (leverance)

Implementering af **DKC-019** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-012, DKC-037, DKC-053 og DKC-063. `00-core/`
er fortsat **ikke ændret**; alt ligger under `01-step1/output/dkc-019/`.

## Forudsætninger og valg

DKC-019 afhænger formelt af **DKC-002** (arkitektur- og deployment-kontrakter),
**DKC-006** (tenantisolering) og **DKC-012** (modelgateway og bindinger).
Overlayen lægges oven på hele den nuværende stak via `dkc-063/apply.sh`, som
kæder `dkc-053/apply.sh` og dermed DKC-001 .. DKC-013 + DKC-055 + DKC-012 +
DKC-037 + DKC-053. **DKC-063 er valgt som forudsætning, fordi den er den
aktuelle stak-top.**

Prerequisite-koden er inspiceret i den faktiske checkout: `conformance/src/architecture.mjs`
(`isNamedHuman`), `identity/src/tenant.mjs` (tenantudledning, scopes,
ressource-ID'er), `gateway/routes.json` + `gateway/src/routing.mjs`
(dataklasser og `approvedDataProcessing`), `persistence/` (migrationer,
tenant-views, adapters) og `compliance/` (kanonisk registry + genereret dokument).

## Hvad der er implementeret

1. **Versioneret kontrakt.** `contracts/data-register.schema.json`
   (`kind: DataRegister`) beskriver pr. post datakategorier, formål,
   behandlingsgrundlag (ejerbesluttet felt), dataansvarlig-/databehandlerrolle
   med kontraktreferencer, placering med **eksplicit tredjelandsvurdering**,
   modtagere, subprocessorer, databærende artefakter og en formålsbestemt,
   versioneret slettefrist med holds. `contracts/examples/data-register.example.json`
   er et komplet eksempel.
2. **Semantisk validator.** `conformance/src/data-register.mjs` håndhæver det,
   skemaet ikke kan: navngivet ejer, ejerbesluttet grundlag (koden opfinder det
   aldrig), blocker for persondata uden beslutning/aftale/vurdering,
   formålsbestemt og versioneret retention, at persondataposter dækker prompts,
   embeddings, supportadgang, logs, backups og modelproviderens databrug, samt
   at EU-hosting ikke automatisk er fravær af overførsel.
3. **Kanonisk register og genereret dokument.** `compliance/data-register.json`
   er kilden; `compliance/src/data-register.mjs` + `data-register-cli.mjs`
   validerer, krydsrefererer mod rigtige moduler og routes og genererer
   `docs/compliance/data-register.md`. `make data-register-check` fejler, hvis
   dokumentet er ude af trit, hvis en post mangler ejer, eller hvis en
   persondatapost ikke er godkendt eller eksplicit markeret som blocker.
4. **Krydsreference mod moduler og routes.** Hvert pilotmodul (fra
   `modules/*/module-manifest.json`, ekskl. `dummy-broken`) og hver aktiveret
   route i `gateway/routes.json` skal have en registerpost med en navngivet ejer.
   En route, der tillader `personal`/`special-category`, kræver
   `approvedDataProcessing`, en processor, en `dpaRef` og en persondataregisterpost
   med processor-kontraktreference.
5. **Ejerbesluttet grundlag og blockere.** `legalBasis.status` er
   `owner-decided` eller `pending-owner-decision`. En uafklaret beslutning må
   ikke angive en `ground`. `entryBlockers` markerer manglende grundlag,
   kontrakt, tredjelandsvurdering og artefakter; en `approved` post med aktive
   blockere afvises af både `make data-register-check` og registertjenesten.
6. **Retention og holds.** Slettefristen er formålsbestemt (`purposeRef` skal
   pege på et formål i samme post), versioneret (`version`) og godkendt af et
   navngivet menneske. Et aktivt `hold` blokerer sletning og kan frigives.
7. **Holdbar persistens.** `persistence/migrations/0007_data_register.sql`
   tilføjer versioner, poster, retention, subprocessorer og holds pr. tenant;
   `persistence/src/adapters/data-register.mjs` gemmer registeret atomisk med
   en SHA-256-digest og eksponerer `getEntry`, `listEntries`, `listBlockers`,
   `placeHold`, `releaseHold` m.fl. Tenant-views er registreret i `db.mjs` og
   verificeres af `make persistence-check` (v7, 18 views).
8. **Tenantautorisation.** `compliance/src/register-service.mjs` udleder
   tenanten af den verificerede principal via `identity/src/tenant.mjs`.
   Krydskunde-adgang kræver platformrollen **og** en eksplicit scope; en
   fremmed tenant afvises ved både læsning og skrivning. Persistenslaget er
   desuden tenant-bundet.
9. **CI og baseline.** `Makefile` får `data-register-write`, `data-register-check`
   og `data-register-test`; `data-register-check`/`-test` indgår i `make ci`.
   `tools/baseline/registry.mjs` registrerer begge checks og komponenten
   `data-register`, så `docs/status/implementation-matrix.md` rapporterer dem.
10. **Dokumentation.** `docs/spec/data-register.md`, ADR-0029
    (`docs/adr/0029-dataregister-og-retention.md`) og syntetiske
    ejerbeslutninger i `docs/compliance/owner-decisions.md`; ADR- og
    spec-indekserne er opdateret.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
Makefile                                             (+ data-register-write/-check/-test, + i ci)
compliance/data-register.json                        (ny: kanonisk register)
compliance/src/data-register.mjs                     (ny: load/render/krydsreference)
compliance/src/data-register-cli.mjs                 (ny: render/write/check/verify)
compliance/src/register-service.mjs                  (ny: tenantautoriseret registertjeneste)
compliance/test/data-register.test.mjs               (ny: kontrakt, semantik, krydsreference, sync)
compliance/test/data-register-service.test.mjs       (ny: tenantautorisation + validering)
conformance/src/data-register.mjs                    (ny: semantisk validator)
conformance/src/schemas.mjs                          (+ dataRegister)
conformance/src/validate-schemas.mjs                 (+ dataregistervalidering)
conformance/test/data-register-conformance.test.mjs  (ny: 4 accepttests)
contracts/data-register.schema.json                  (ny: kind DataRegister)
contracts/examples/data-register.example.json        (ny: komplet eksempel)
docs/adr/0029-dataregister-og-retention.md           (ny: ADR)
docs/adr/README.md                                   (+ ADR-0029)
docs/compliance/data-register.md                     (ny: genereret tabel)
docs/compliance/owner-decisions.md                   (ny: syntetiske ejerbeslutninger)
docs/compliance/README.md                            (+ dataregisterafsnit)
docs/spec/README.md                                  (+ data-register)
docs/spec/data-register.md                           (ny: spec)
docs/status/implementation-matrix.md                 (regenereret med DKC-019-checks)
persistence/migrations/0007_data_register.sql        (ny: v7)
persistence/src/adapters/data-register.mjs           (ny: holdbart register)
persistence/src/db.mjs                               (+ 5 tenant-views)
persistence/src/index.mjs                            (+ eksport)
persistence/test/data-register.test.mjs              (ny: 5 tests)
persistence/test/migrations.test.mjs                 (v6 → v7)
tools/baseline/registry.mjs                          (+ component + 2 checks)
```

## Testkommandoer og resultater

Alle kørsler er fra `00-core/` i den disposable checkout
(`/tmp/dkc-019/00-core`, commit `83ad91a`, Node v22.22.1). Fuld log ligger i
`evidence/`.

| Kommando | Resultat |
| --- | --- |
| `make validate` | ✔ 43 kontraktskemaer, 42 eksempler, 1 dataregister-eksempel (skema + semantik) |
| `make lint` | ✔ 257 JSON-filer, 635 filer |
| `make data-register-check` | ✔ dokument i trit; 6 poster, 2 subprocessorer, 0 aktive blockere |
| `make data-register-test` | ✔ 23 tests (14 compliance + 5 persistence + 4 conformance), 0 fail |
| `make compliance-test` | ✔ 18 tests, 0 fail |
| `make persistence-check` | ✔ 7 migrationer (v1..v7), 4 databaseidentiteter, 18 tenant-views |
| `make persistence-test` | ✔ 52 tests, 0 fail |
| `make test` (conformance-suiten) | ✔ 119 tests, 0 fail |
| `make tenant-check` | ✔ tenant-kontekst + ressource-/scope-semantik |
| `make gateway-check` | ✔ 4 routes, dataklasser og egress-allowliste |
| `make architecture-test` | ✔ 10 tests, 0 fail |
| `make baseline-test` | ✔ 8 tests, 0 fail |
| `make baseline` | 69 pass, 1 fail, 0 error, 10 not run af 80. Det ene fail er `changelog-check` (4 eksisterende commits uden DCO sign-off) — en præeksisterende repo-tilstand, ikke DKC-019. `data-register-check`/`-test` = PASS. |

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Alle pilotmoduler og routes har ejer og godkendt registerpost | **PASS** | `make data-register-check` (krydsreference mod `modules/` + `gateway/routes.json`), `conformance/test/data-register-conformance.test.mjs` |
| Manglende beslutning eller aftale markeres som blocker for persondata | **PASS** | `entryBlockers` + `dataRegisterProblems`; `compliance/test/data-register.test.mjs`, `persistence/test/data-register.test.mjs`; tjenesten afviser `approved` med aktive blockere |
| Retention er formålsbestemt og versioneret | **PASS** | `retention.purposeRef` skal findes i posten og `version` er påkrævet; validator + tests |
| EU-hosting markeres ikke automatisk som fravær af tredjelandsoverførsel | **PASS** | `location.thirdCountryTransfer.assessed` kræves for alle poster; `status: none` kræver begrundelse; tests i compliance og conformance |

Alle fire acceptkriterier er **PASS**. Ingen er FAIL eller NOT RUN.

## Grænser og forbehold

- Registeret er en påstand om **mekanismer**, ikke en juridisk vurdering.
  Ejerbeslutningerne i `docs/compliance/owner-decisions.md` er syntetiske
  referencebeslutninger og erstatter ikke en rigtig DPO-/ledelsesbeslutning.
- Der findes ingen kørende HTTP-API i repoet. `register-service.mjs` er den
  kaldeflade, en API-grænse skal bruge, og tenantautorisationen er efterprøvet
  isoleret (egne data, fremmed tenant, scopet platformrolle).
- Persistensen er file-/in-memory SQLite som resten af `persistence/`; intet
  deployet runtime eller ekstern database er bevist.
- `make baseline` fejler på `changelog-check` (DCO sign-off på eksisterende
  commits). Det er præeksisterende og uden for DKC-019.
- Konformans mod en rigtig ekstern DPO- eller revisionsinstans er ikke kørt.

## Review

- Reviewets base: `5f9fa73` · undersøgt checkout: `83ad91a`.
- Forudsætnings-overlays: `dkc-063/apply.sh` (kæder DKC-001 .. DKC-013 +
  DKC-055 + DKC-012 + DKC-037 + DKC-053).
- Pakken er verificeret med `sha256sum -c OVERLAY-MANIFEST.txt` og med
  `./apply.sh` på et rent klon.
