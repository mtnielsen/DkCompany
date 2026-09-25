# DKC-012 — Gør modelgateway anvendelig og budgetter bindende (leverance)

Implementering af **DKC-012** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-011, DKC-013 og DKC-055. `00-core/` er fortsat **ikke ændret**;
alt ligger under `01-step1/output/dkc-012/`.

## Forudsætninger og valg

DKC-012 afhænger formelt af **DKC-003** (verificerbar identitet), **DKC-006**
(tenantisolering), **DKC-008** (holdbar tilstand og budgetter) og **DKC-011**
(værktøjsgrænse). Den lægges oven på hele den nuværende stak via
`dkc-013/apply.sh`, som kæder `dkc-011/apply.sh` og dermed DKC-001 .. DKC-011 +
DKC-055. **DKC-013 er valgt som forudsætning, fordi den er den aktuelle
stak-top**; den deler desuden idempotens-/lease-mønstret med gatewayens
reservationsmodel.

## Hvad der er implementeret

1. **Reel leverandøradapter bag gatewayen.** `gateway/src/providers/openai-compatible.mjs`
   taler OpenAI-kompatibel `/chat/completions` over rigtig HTTP (også SSE-streaming),
   med serverstyret timeout, `AbortSignal`, `onToken` og faktisk forbrugsrapportering
   (`tokens`, `costEur`) — også når et stream afbrydes midtvejs. Echo-provideren
   bevares til deterministiske tests. CLI'en vælger adapter ud fra
   `MODEL_PROVIDER_BASE_URL`/`MODEL_PROVIDER_API_KEY`; nøglen ligger aldrig i
   `routes.json`.

2. **Serverstyret route efter kunde og dataklasse.** `gateway/src/routing.mjs`
   slår routen op ud fra tenant, `agentRef` og `dataClass`. Ukendt dataklasse
   afvises (`422`). Personhenførbare klasser (`personal`, `special-category`)
   kræver `approvedDataProcessing: true` og en `processor`. En klientangivet
   leverandør/model skal matche routen, og `max_tokens` må ikke overstige
   route'ens `maxOutputTokens`. `gateway/routes.json` er udvidet med
   `dataClasses`, `approvedDataProcessing`, `processor`, `dpaRef`,
   `maxOutputTokens`, `timeoutMs` og `costPerTokenEur`; skemaet og eksemplet er
   opdateret.

3. **Atomisk budgetreservation, max-output, timeout/cancel, afregning og
   idempotency.** Migration `0006_model_gateway_budgets.sql` tilføjer
   `reserved_tokens`/`reserved_cost_eur`/`ceiling_cost_eur` til `budgets` samt
   `budget_reservations` og `gateway_calls`.
   `persistence/src/adapters/budgets.mjs` får `reserve`/`settle`/`release` i
   `BEGIN IMMEDIATE`: loftet kontrolleres mod `forbrug + reserveret + ny
   reservation`, så samtidige kald ikke kan bruge den samme rest.
   `persistence/src/adapters/gateway-calls.mjs` giver idempotens pr.
   `(tenant, idempotency-key)` og replay uden nyt leverandørkald.
   `gateway/src/accounting.mjs` binder reservation og idempotens sammen:
   timeout/streaming-afbrydelse afregner det modtagne og frigiver resten, og et
   retry med samme nøgle genoptages. `gateway/src/gateway.mjs` understøtter nu
   `data_class`, `idempotency-key`, streaming (SSE) og redaktionssikker logning.

4. **Blokeret direkte model-egress; reviewerens reelle provider dokumenteret.**
   `gateway/src/egress.mjs` afviser enhver anden principal end gatewayen og
   enhver vært uden for leverandør-allowlisten; adapteren kalder vagten før
   hvert kald. GitOps-materialet (`model-egress-default-deny.json`,
   `model-egress-gateway-allow.json`) og `gitops/src/egress.mjs` håndhæver det i
   den ønskede klyngetilstand. `gateway/src/reviewer-provider.mjs` forbinder
   reviewerens `review()`-interface til gatewayen, så revieweren bruger en anden
   leverandør end forfatteren uden egen leverandøradgang; det er dokumenteret i
   `docs/spec/reviewer.md`.

5. **Kontrakter, checks og docs.** Nye/opdaterede checks: `gateway-check`,
   `budget-test`, `model-egress-check`, `model-gateway-test` samt udvidet
   `gateway-test`. ADR-0025 og den omskrevne `docs/spec/ai-gateway.md`
   dokumenterer designet; `docs/spec/reviewer.md`, indeks og
   `docs/status/implementation-matrix.md` er opdateret.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
Makefile                                        (+ gateway-check, budget-test, model-egress-check, model-gateway-test)
conformance/test/model-gateway-conformance.test.mjs (ny: 6 accepttests)
contracts/gateway-route.schema.json             (+ dataClasses, godkendt databehandling, maxOutputTokens, timeoutMs, costPerTokenEur)
contracts/examples/gateway-route.example.json   (+ nye felter)
docs/adr/0025-modelgateway-og-bindende-budgetter.md (ny ADR)
docs/adr/README.md, docs/spec/README.md         (opdateret)
docs/spec/ai-gateway.md                         (omskrevet: reel adapter, routing, budget, egress)
docs/spec/reviewer.md                           (+ reviewerens gateway-vej)
docs/status/implementation-matrix.md            (regenereret)
gateway/routes.json                             (+ dataklasser, godkendt databehandling, budget, reviewer-route)
gateway/src/routing.mjs                         (ny: serverstyret routing)
gateway/src/egress.mjs                          (ny: model-egress-vagt)
gateway/src/accounting.mjs                      (ny: reservation + idempotens)
gateway/src/providers/openai-compatible.mjs     (ny: reel HTTP-adapter)
gateway/src/reviewer-provider.mjs               (ny: reviewerens gateway-provider)
gateway/src/gateway.mjs                         (+ dataklasser, accounting, streaming, redaktion)
gateway/src/cli.mjs                             (+ reel provider, sqlite-budget)
gateway/src/check.mjs                           (ny: route-/egress-kontrol)
gateway/test/*.test.mjs                         (ny: routing/accounting, HTTP-provider, egress)
gitops/manifests/dev/ai-gateway-*.json          (ny: deployment, service, serviceaccount, config)
gitops/manifests/dev/model-egress-*.json        (ny: default-deny + gateway-allow)
gitops/apps/ai-gateway-application.json         (ny)
gitops/src/egress.mjs, gitops/src/cli.mjs       (ny verifier + `egress`-kommando)
gitops/test/egress.test.mjs                     (ny)
persistence/migrations/0006_model_gateway_budgets.sql (ny)
persistence/src/adapters/budgets.mjs            (+ reserve/settle/release)
persistence/src/adapters/gateway-calls.mjs      (ny: idempotens/afregning)
persistence/src/db.mjs, index.mjs               (+ 2 tenant-views, eksport)
persistence/test/model-gateway-budgets.test.mjs (ny)
persistence/test/migrations.test.mjs            (+ v6)
runtime/src/clients.mjs                         (+ dataklasse, idempotency-key, streaming/abort)
runtime/test/gateway-client.test.mjs            (ny)
reviewer/test/reviewer-provider.test.mjs        (ny)
tools/baseline/registry.mjs                     (+ 4 checks, opdateret ai-gateway)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..013 + DKC-055, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make gateway-check` | **OK** (4 routes, 4 leverandører, 4 egress-værter; 5 dataklasser) |
| `make gateway-test` | **28 pass / 0 fail** |
| `make model-gateway-test` | **34 pass / 0 fail** (28 gateway + 6 konformans-accepttests) |
| `make budget-test` | **5 pass / 0 fail** (reservation, samtidighed, idempotens, privatliv) |
| `make model-egress-check` | **OK** (3/3 egress-gates) |
| `make test` (conformance) | **95 pass / 0 fail** (inkl. 6 nye DKC-012-accepttests) |
| `make persistence-check` | **OK** (6 migrationer, 4 databaseidentiteter, 13 tenant-views) |
| `make persistence-test` | **47 pass / 0 fail** (inkl. 5 nye reservationstests) |
| `make runtime-test` | **86 pass / 0 fail** (inkl. 2 nye gateway-klienttests) |
| `make jobs-test` | **4 pass / 0 fail** (ingen regression) |
| `make agent-registry-test` | **33 pass / 0 fail** |
| `make tool-boundary-test` | **8 pass / 0 fail** |
| `make credentials-test` | **4 pass / 0 fail** |
| `make gitops-test` | **13 pass / 0 fail** (inkl. 3 nye egress-gates) |
| `make gitops-verify` | **OK** (9/9) |
| `make reviewer-test` | **5 pass / 0 fail** (inkl. 2 nye reviewer-provider-tests) |
| `make validate` | **33 skemaer / 32 eksempler** valideret |
| `make lint` | **OK** (202 JSON-filer, 525 filer) |
| `make baseline` | **60 pass, 1 fail (DCO), 0 error, 9 not run af 70**; alle fire nye checks **PASS** |

`make baseline`'s ene fejl er DKC-001's kendte `changelog-check` (4 commits
mangler DCO sign-off). Baselinekørslen ændrede 30 committede fixture-filer under
`modules/*/conformance`; de er nulstillet med
`git checkout -- modules/*/conformance` fra `00-core/`.

## Acceptkriterier

| Krav | Status | Bevis |
| --- | --- | --- |
| Klient kan ikke hæve budget eller vælge en forbudt provider | **PASS** | `conformance/test/model-gateway-conformance.test.mjs` (1), `gateway/test/model-gateway.test.mjs` (`max_output_forbidden`, `provider_forbidden`) |
| Samtidige kald kan ikke bruge samme resterende budget | **PASS** | `model-gateway-conformance.test.mjs` (2), `persistence/test/model-gateway-budgets.test.mjs` (atomisk reservation) |
| Timeout, streaming-afbrydelse og retry medfører korrekt opgørelse | **PASS** | `model-gateway-conformance.test.mjs` (3a/3b), `gateway/test/provider-http.test.mjs` (timeout + afbrudt stream), `gateway/test/model-gateway.test.mjs` (timeout-afregning + retry) |
| Ukendt dataklasse afvises og rå persondata logges ikke som standard | **PASS** | `model-gateway-conformance.test.mjs` (4), `gateway/test/model-gateway.test.mjs` (log-privatliv), `persistence/test/model-gateway-budgets.test.mjs` (ingen rå tekst for `personal`) |
| Netværkstest viser at direkte provideradgang er blokeret | **PASS** | `model-gateway-conformance.test.mjs` (5), `gateway/test/model-egress.test.mjs` (rigtig loopback-server; workload afvises før netværk), `make model-egress-check` |

## Resterende begrænsninger

- **Ingen rigtig leverandørnøgle/-endpoint.** Den reelle adapter er efterprøvet
  mod en rigtig HTTP-server på loopback, men et kald mod fx `api.openai.com`
  med en levende nøgle er **NOT RUN** (`integration-llm`). Det kræver en
  driftshemmelighed, som ikke må ligge i repoet.
- **Netværkstesten er lokal.** Egress-blokeringen er bevist i kode (identitets-
  og host-vagt) og i den ønskede GitOps-tilstand (NetworkPolicy/Cilium).
  Håndhævelsen i en levende klynge med en rigtig CNI er **NOT RUN**.
- **Streaming-afregning bygger på leverandørens `usage` eller en token-estimat.**
  Ved afbrydelse før en `usage`-blok afregnes et estimat ud fra det modtagne;
  leverandører der ikke rapporterer `usage` i streamet giver derfor et estimat.
- **Budgetloftet pr. route er en serverkonfiguration.** En ændring af
  `maxTokens`/`maxCostEur` i `routes.json` er en GitOps-ændring, ikke noget en
  klient kan gøre; men selve route-tabellen er endnu ikke signeret.
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001 .. DKC-011, DKC-013 samt DKC-055 (lægges
  via `apply.sh`, som kæder `dkc-013/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-012/` (43 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`; 21 evidensfiler).
- Uafhængig verifikation, en levende leverandør og menneskelig
  release-godkendelse er separate handlinger og er **ikke** udført her.
