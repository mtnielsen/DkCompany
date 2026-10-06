# ADR-0025: Serverstyret modelgateway med bindende, atomiske budgetter

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-012. ADR-0006 gjorde gatewayen til den eneste modelvej, men leverandøren var en echo-stub, routen kunne ikke skelne dataklasser, budgettet var in-memory og blev først kontrolleret *før* kaldet, og en agent-workload havde ingen egentlig egress-grænse. Uden en reel leverandøradapter, serverstyret routing og et budget der reserveres atomisk, er "alle modelkald gennem gatewayen" en påstand uden håndhævelse.

## Kontekst og problemstilling

- **Ingen reel leverandør.** `gateway/src/provider.mjs` havde kun `createEchoProvider` og `createFailingProvider`; ingen adapter talte med en leverandør over HTTP.
- **Klienten kunne påvirke routing.** `model` og route-id kom fra klienten, og der fandtes ingen dataklasse-begreb, så en route kunne bruges til personhenførbare data uden godkendt databehandling.
- **Budget var in-memory og ikke bindende på tværs af processer.** `usage`-mappet forsvandt ved genstart, og to samtidige workers delte ikke en holdbar saldo.
- **Intet timeout/cancel/streaming-regnskab.** Et afbrudt kald kunne efterlade et forbrug uden afregning.
- **Ingen egress-grænse.** En workload kunne i princippet kontakte en leverandør direkte, og der fandtes ingen netværkspolitik der blokerede det.

## Beslutningskriterier

- Én reel leverandøradapter bag gatewayen; echo bevares til deterministiske tests.
- Routen er serverstyret efter kunde og dataklasse; klienten kan ikke vælge leverandør eller hæve budget/max-output.
- Personhenførbare dataklasser kræver godkendt databehandling.
- Budgettet reserveres atomisk før kaldet og afregnes bagefter; timeout, streaming-afbrydelse og retry bogføres korrekt.
- Ukendte dataklasser afvises, og rå persondata logges ikke som standard.
- Direkte model-egress fra workloads er blokeret i kode og i GitOps.

## Overvejede muligheder

- **Behold echo-provideren og kald det "modeladgang".** Opfylder ikke kravet om en reel adapter.
- **Lad klienten vælge leverandør/model.** Giver ikke serverstyret routing og kan omgå godkendt databehandling.
- **In-memory budget med en tæller pr. agent.** Kan ikke binde på tværs af processer og overlever ikke genstart.
- **Reel HTTP-adapter + serverstyret routing + holdbar reservationsmodel + egress-vagt.** Kræver en migration, men lukker alle acceptkrav.

## Beslutning

1. **Reel leverandøradapter.** `gateway/src/providers/openai-compatible.mjs` taler OpenAI-kompatibel `/chat/completions` over rigtig HTTP, med streaming, timeout, afbrydelse og faktisk forbrugsrapportering. Echo-provideren bevares til tests.
2. **Serverstyret routing.** `gateway/src/routing.mjs` slår routen op ud fra `tenantId`, `agentRef` og `dataClass`. En ukendt dataklasse afvises (fail-closed). Personhenførbare klasser (`personal`, `special-category`) kræver `approvedDataProcessing: true` og en `processor`. En klientangivet leverandør/model skal stemme med routen, og `max_tokens` må ikke overstige route'ens `maxOutputTokens`.
3. **Atomisk reservation.** Migration `0006_model_gateway_budgets.sql` tilføjer `reserved_tokens`/`reserved_cost_eur` og `ceiling_cost_eur` til `budgets` samt `budget_reservations` og `gateway_calls`. `persistence/src/adapters/budgets.mjs` får `reserve`/`settle`/`release` i `BEGIN IMMEDIATE`, så to samtidige kald ikke kan bruge den samme resterende budgetpost. `gateway/src/accounting.mjs` binder reservation og idempotens sammen.
4. **Afregning ved timeout/cancel/retry.** Et afbrudt kald afregner det faktisk modtagne og frigiver resten; et retry med samme idempotency-key genoptages og afregnes separat. `gateway_calls` giver idempotens og replay uden nyt leverandørkald.
5. **Privatliv som standard.** Gatewayens logpost indeholder metadata, dataklasse, request-digest og forbrug — aldrig rå samtaleindhold. For personhenførbare klasser gemmes heller ikke modelteksten i idempotens-kvitteringen.
6. **Egress-vagt.** `gateway/src/egress.mjs` afviser enhver anden principal end gatewayen og enhver vært uden for leverandør-allowlisten. `gateway/src/providers/openai-compatible.mjs` kalder vagten før hvert kald. GitOps-materialet (`model-egress-default-deny.json`, `model-egress-gateway-allow.json`) og `gitops/src/egress.mjs` håndhæver det i den ønskede klyngetilstand.
7. **Reviewerens leverandør.** `gateway/src/reviewer-provider.mjs` forbinder reviewerens `review()`-interface til gatewayens route, så revieweren bruger en anden leverandør end forfatteren uden egen leverandøradgang.

## Konsekvenser

- **Positive:** Gatewayen er nu en reel modelvej. Budgettet er bindende på tværs af processer og overlever genstart. Afbrudte kald og retries afregnes korrekt. Persondata logges ikke som standard. Direkte egress er blokeret både i kode og i klyngen.
- **Negative:** Endnu en migration (v6) og flere tabeller. Leverandørnøglen er en driftshemmelighed og er ikke i repoet; integrationen mod en rigtig leverandør er derfor fortsat en separat (NOT RUN) handling.
- **Neutrale:** Echo-provideren bevares, så eksisterende tests er deterministiske. `ai-gateway`-komponenten får fire nye checks i baseline.

## Mere information

- [`docs/spec/ai-gateway.md`](../spec/ai-gateway.md), [`docs/spec/reviewer.md`](../spec/reviewer.md)
- [`gateway/src/routing.mjs`](../../gateway/src/routing.mjs), [`gateway/src/accounting.mjs`](../../gateway/src/accounting.mjs), [`gateway/src/egress.mjs`](../../gateway/src/egress.mjs), [`gateway/src/providers/openai-compatible.mjs`](../../gateway/src/providers/openai-compatible.mjs)
- [`persistence/src/adapters/budgets.mjs`](../../persistence/src/adapters/budgets.mjs), [`persistence/src/adapters/gateway-calls.mjs`](../../persistence/src/adapters/gateway-calls.mjs), [`persistence/migrations/0006_model_gateway_budgets.sql`](../../persistence/migrations/0006_model_gateway_budgets.sql)
- [ADR-0006](0006-alle-modelkald-gennem-gateway.md), [ADR-0017](0017-tenant-kontekst-og-ressource-id.md), [ADR-0019](0019-holdbar-tilstand-og-migrationer.md), [ADR-0023](0023-vaerktoejsgraense-og-injection.md)
