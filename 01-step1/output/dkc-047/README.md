# DKC-047 — Dataklasser for AI-immutable (leverance)

Implementering af **DKC-047** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-012, DKC-037, DKC-053, DKC-063 og DKC-019.
`00-core/` er fortsat **ikke ændret**; alt ligger under
`01-step1/output/dkc-047/`.

## Forudsætninger og valg

DKC-047 afhænger formelt af **DKC-007** (streng policy/scope/evidenskontrol),
**DKC-019** (dataregister og retention) og **DKC-037** (serviceklasser).
Overlayen lægges oven på hele stakken via `dkc-019/apply.sh`, som kæder
`dkc-063/apply.sh` og dermed DKC-001 .. DKC-013 + DKC-055 + DKC-012 + DKC-037 +
DKC-053 + DKC-063. **DKC-019 er valgt som forudsætning, fordi den er den
aktuelle stak-top.**

Prerequisite-koden er inspiceret i den faktiske checkout:
`runtime/src/classification.mjs` og `runtime/src/boundary.mjs` (A4, scope,
klassifikation), `policy/pdp/` (signeret bundle, fail-closed PDP),
`contracts/module-manifest.schema.json` (capability-deklarationer),
`compliance/data-register.json` (DKC-019) og `docs/adr/0029`.

## Hvad der er implementeret

1. **Versioneret kontrakt.** `contracts/protected-data.schema.json`
   (`kind: ProtectedDataRegister`) med klasserne `ordinary`, `ai-read-only`,
   `append-only` og `retention-locked`, og `noAiAccess` som **selvstændigt
   adgangsflag**. Hver post bærer ejer, versions-ID, autoritativ pointer,
   nøgledomæne, reclassifiers, retention/hold, de otte forbud, den menneskelige
   proces og en ærlig `storageEnforcement`-erklæring.
   `contracts/examples/protected-data.example.json` er et komplet eksempel.
2. **Semantisk validator.** `conformance/src/protected-data.mjs` kræver navngivet
   ejer og reclassifiers, at en beskyttet klasse dækker alle otte forbud, at
   `retention-locked` har en vurderet formålsbestemt og **endelig** frist (også
   for persondata), og at fuld lagerhåndhævelse ikke påstås uden bevis.
3. **Beskyttelsespolitik og register.** `data-protection/policy/access-policy.json`
   er den versionerede adgangs-/transitionsmatrix;
   `data-protection/records/register.json` er det kanoniske register.
   `data-protection/src/check.mjs` validerer begge og krydsrefererer mod
   moduler/routes. `docs/compliance/protected-data.md` genereres og
   `make data-protection-check` fejler ved drift.
4. **Deny-only guard.** `data-protection/src/guard.mjs` er ren og kan kun fjerne
   rettigheder. Den adskiller:
   - **AI-ændringsforbud**: ingen AI-mutation af en beskyttet post, inkl.
     alias-/current-pointer, policy, lifecycle, nøgler og sletning.
   - **WORM-retention**: `retention-locked` er immutable; retention og aktivt
     hold skal følge med i en transition.
   - **AI-læseforbud**: `noAiAccess` udelukker alle AI-flows, også retrieval,
     prompts, logs og trænings-/analyse.
5. **Runtimehåndhævelse.** `runtime/src/runtime.mjs` kalder guarden efter
   scope/rolle og **før** PDP og executor. En allow-beslutning eller en
   menneskelig godkendelse kan ikke omgå den. `guardAdapterCall` gør app-,
   admin- og restore-adaptere identiske.
6. **Policy-input og capabilities.** `contracts/policy-input.schema.json` får
   `context.dataClass`, `noAiAccess`, `operation` og `protection`;
   `contracts/agent-task.schema.json` får de tilsvarende handlingsfelter;
   `contracts/module-manifest.schema.json` får en `dataProtection`-blok, og de
   fire pilotmoduler erklærer ærligt deres klasser og DKC-048-hullet.
7. **Ærlig lagerhåndhævelse.** Alle poster erklærer `unsupported` og
   `deliveredBy: DKC-048`. `make data-protection-check` udskriver hullerne og
   afviser en `full`-påstand uden bevis. Fuld fysisk lager-/nøglehåndhævelse er
   **ikke** leveret her og er påkrævet før beskyttelsen kan kaldes
   uigennemtrængelig.
8. **CI og baseline.** `Makefile` får `data-protection-write/-check/-test`;
   check/test indgår i `make ci`. `tools/baseline/registry.mjs` registrerer
   komponenten `data-protection` og begge checks, så
   `docs/status/implementation-matrix.md` rapporterer dem.
9. **Dokumentation.** `docs/spec/data-protection.md`, ADR-0030
   (`docs/adr/0030-ai-immutable-dataklasser.md`) og opdaterede ADR-/spec-/
   compliance-indeks.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
Makefile                                             (+ data-protection-write/-check/-test, + i ci)
conformance/src/protected-data.mjs                   (ny: semantisk validator)
conformance/src/schemas.mjs                          (+ protectedData)
conformance/src/validate-schemas.mjs                 (+ beskyttelsesvalidering)
conformance/test/protected-data-conformance.test.mjs (ny: 4 accepttests)
contracts/protected-data.schema.json                 (ny: kind ProtectedDataRegister)
contracts/examples/protected-data.example.json       (ny: komplet eksempel)
contracts/policy-input.schema.json                   (+ dataClass/noAiAccess/operation/protection)
contracts/agent-task.schema.json                     (+ beskyttede handlingsfelter)
contracts/module-manifest.schema.json                (+ dataProtection-capability)
data-protection/package.json                         (ny)
data-protection/policy/access-policy.json            (ny: adgangs-/transitionsmatrix)
data-protection/records/register.json                (ny: 6 beskyttede poster)
data-protection/src/{classes,policy,guard,registry,render,check,cli}.mjs (ny)
data-protection/test/{guard,transition,register}.test.mjs (ny: 19 tests)
docs/spec/data-protection.md                         (ny: spec)
docs/adr/0030-ai-immutable-dataklasser.md            (ny: ADR)
docs/compliance/protected-data.md                    (ny: genereret tabel)
docs/{adr,spec,compliance}/README.md                 (opdateret)
docs/status/implementation-matrix.md                 (regenereret med DKC-047-checks)
modules/{audit-service,dummy-ok,keycloak-adapter,mattermost-adapter}/module-manifest.json (+ dataProtection)
runtime/src/runtime.mjs                              (+ guard før PDP/executor)
runtime/test/protected-data-runtime.test.mjs         (ny: 4 runtimehåndhævelsestests)
tools/baseline/registry.mjs                          (+ component + 2 checks)
```

## Testkommandoer og resultater

Alle kørsler er fra `00-core/` i den disposable checkout
(`/tmp/dkc-047/00-core`, commit `83ad91a`, Node v22.22.1). Fuld log ligger i
`evidence/`.

| Kommando | Resultat |
| --- | --- |
| `make validate` | ✔ 44 kontraktskemaer, 43 eksempler, 1 beskyttelsesregister-eksempel (skema + semantik) |
| `make lint` | ✔ 262 JSON-filer, 656 filer |
| `make data-protection-check` | ✔ 6 poster, 4 klasser, 4 routes; 6 ærlige DKC-048-huller |
| `make data-protection-test` | ✔ 27 tests (19 data-protection + 4 runtime + 4 conformance), 0 fail |
| `make runtime-test` | ✔ 90 tests, 0 fail (ingen regression) |
| `make test` (conformance-suiten) | ✔ 123 tests, 0 fail |
| `make data-register-test` | ✔ 23 tests, 0 fail (DKC-019 uændret) |
| `make baseline-test` | ✔ 8 tests, 0 fail |
| `make baseline` | 82 checks: 71 pass, 1 fail, 0 error, 10 not run. Det ene fail er `changelog-check` (4 eksisterende commits uden DCO sign-off) — præeksisterende og uden for DKC-047. `data-protection-check`/`-test` = PASS. |

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| AI-read-only kan ikke omgås ved at kalde en app-, admin- eller restoreadapter | **PASS** | `guardAdapterCall` + `data-protection/test/guard.test.mjs`, `runtime/test/protected-data-runtime.test.mjs` |
| No-AI-access udelukker også retrieval, prompts, logs og trænings-/analyseflows | **PASS** | `access-policy.json` + guard; tests for `read/retrieve/prompt/train/analyze/log-access` |
| AI kan ikke omklassificere data eller omskrive den autoritative pointer | **PASS** | `authorizeReclassification` afviser AI; `aiForbiddenOperations` inkl. `reclassify`/`pointer-update`; tests |
| Beskyttelsen overlever kopiering, eksport og restore efter vedtaget politik | **PASS** | `transitionProblems` + `retentionTransitionProblems`; `data-protection/test/transition.test.mjs` |
| Ingen ubestemt WORM-lås på persondata uden vurderet formål og frist | **PASS** | `protectedDataProblems` kræver retention med formål/endelig frist; test i data-protection og conformance |

Alle fem acceptkriterier er **PASS**. Ingen er FAIL eller NOT RUN.

## Grænser og forbehold

- DKC-047 er **adgangs- og transitionskontrol**. Fuld fysisk lager-/nøgle-
  håndhævelse (WORM-lager, nøgleødelæggelse, uforanderlige snapshots) leveres af
  **DKC-048** og er påkrævet, før beskyttelsen kan kaldes uigennemtrængelig. Alle
  poster erklærer dette ærligt.
- Beskyttelsespolitikken er en delt, versioneret regel uden for den signerede
  platform-bundle, så den kan revideres uden at re-signere bundlen. Den er
  deny-only oven på PDP'en.
- Ingen kørende ekstern nøgletjeneste eller et rigtigt WORM-lager er bevist i
  dette miljø.
- `make baseline` fejler på `changelog-check` (DCO sign-off på eksisterende
  commits). Det er præeksisterende og uden for DKC-047.
- Uafhængig verifikation, penetrationstest og produktionsrelease er ikke
  udført.

## Review

- Reviewets base: `5f9fa73` · undersøgt checkout: `83ad91a`.
- Forudsætnings-overlays: `dkc-019/apply.sh` (kæder DKC-001 .. DKC-013 +
  DKC-055 + DKC-012 + DKC-037 + DKC-053 + DKC-063 + DKC-019).
- Pakken er verificeret med `sha256sum -c OVERLAY-MANIFEST.txt` og med
  `./apply.sh` på et rent klon.
