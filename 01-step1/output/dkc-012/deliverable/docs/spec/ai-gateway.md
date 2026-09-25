# AI-gatewayen

**Kode:** [`gateway/`](../../gateway)
**Kontrakter:** [`gateway-route.schema.json`](../../contracts/gateway-route.schema.json)
**Backlog:** 2.2 · DKC-012
**ADR:** [ADR-0006](../adr/0006-alle-modelkald-gennem-gateway.md), [ADR-0025](../adr/0025-modelgateway-og-bindende-budgetter.md)

## Formål

Alle modelkald går gennem én gateway. Direkte leverandørkald er forbudt. Det giver budget, logging, modelversionering og leverandørskifte ét sted — og gør "hvilken model traf denne beslutning?" besvarligt at omgå.

DKC-012 gør gatewayen anvendelig i drift: en reel leverandøradapter, serverstyret routing efter kunde og dataklasse og et budget der reserveres atomisk. Klienten er en agent-workload uden leverandørnøgler og uden egress til leverandørværter.

## Reel leverandøradapter

`gateway/src/providers/openai-compatible.mjs` implementerer OpenAI-kompatibel `/chat/completions` over rigtig HTTP:

- streaming (`stream: true`, SSE) med `onToken`,
- serverstyret `timeoutMs` og afbrydelse via `AbortSignal`,
- faktisk forbrug (`tokens`, `costEur`) — også når et stream afbrydes midtvejs,
- `ProviderTimeoutError`, `ProviderCancelledError` og `ProviderError`, som gatewayen omsætter til korrekt bogføring.

Echo-provideren (`gateway/src/provider.mjs`) bevares til deterministiske tests. CLI'en vælger adapter ud fra `MODEL_PROVIDER_BASE_URL`/`MODEL_PROVIDER_API_KEY` (nøglen ligger aldrig i `routes.json`):

```bash
MODEL_PROVIDER_BASE_URL=https://api.openai.com/v1 \
MODEL_PROVIDER_API_KEY=... \
GATEWAY_DB_PATH=/var/lib/gateway/gateway.sqlite \
  node gateway/src/cli.mjs --provider openai-compatible
```

En rigtig leverandørnøgle/-endpoint er en driftshemmelighed og er **ikke** en del af repoet; integrationen mod en levende leverandør er derfor `integration-llm` (NOT RUN). Adapteren er efterprøvet mod en rigtig HTTP-server på loopback.

## Serverstyret routing

Routen er serverens, ikke klientens. Klienten angiver kun sin agent-identitet, `data_class` og samtalen. `gateway/src/routing.mjs` afgør:

| Regel | Afvisning |
| --- | --- |
| Routen skal høre til kundens tenant | `403 route_not_found` |
| Routen skal tillade den angivne dataklasse | `403 data_class_forbidden` |
| Ukendt dataklasse afvises altid | `422 data_class_unknown` |
| Personhenførbar klasse kræver godkendt databehandling + `processor` | `403 processing_not_approved` |
| Klientens `provider` skal matche routen | `403 provider_forbidden` |
| Klientens `model` skal matche routen | `403 model_forbidden` |
| `max_tokens` må ikke overstige route'ens `maxOutputTokens` | `403 max_output_forbidden` |

Dataklasser: `public`, `internal`, `confidential`, `personal`, `special-category`. Manglende route, deaktiveret route eller en dataklasse routen ikke tillader giver ingen modeladgang (`403`).

```json
{
  "id": "dummy-ok-upgrader-sonnet",
  "agentRef": "dummy-ok-upgrader",
  "provider": "anthropic",
  "model": "claude-sonnet",
  "modelVersion": "2025-01",
  "dataClasses": ["public", "internal", "confidential"],
  "approvedDataProcessing": false,
  "maxTokens": 200000,
  "maxCostEur": 25,
  "maxOutputTokens": 8192,
  "timeoutMs": 30000,
  "costPerTokenEur": 0.000003,
  "enabled": true
}
```

`gateway/routes.json` valideres mod skemaet i CI (`make gateway-check`), og konformanscheck `A-003` kræver, at enhver agent har en aktiv route.

## Bindende budgetter

Forbrug er tenant-bundet og holdbart. Gatewayen reserverer et maksimalt beløb (input + route'ens max-output) **før** kaldet og afregner det faktiske brug bagefter:

- `persistence/src/adapters/budgets.mjs` implementerer `reserve`/`settle`/`release` i `BEGIN IMMEDIATE`. Loftet kontrolleres mod `forbrug + reserveret + ny reservation`, så to samtidige kald ikke kan bruge den samme resterende budgetpost.
- `persistence/src/adapters/gateway-calls.mjs` giver idempotens pr. `(tenant, idempotency-key)`: en gentaget request får den gemte kvittering uden nyt leverandørkald og uden dobbeltforbrug. Samme nøgle med et andet indhold afvises (`409 idempotency_conflict`).
- `gateway/src/accounting.mjs` binder reservation og idempotens sammen. Timeout/afbrudt kald afregner det modtagne og frigiver resten; et retry med samme nøgle genoptages.
- Migration `0006_model_gateway_budgets.sql` tilføjer `reserved_tokens`, `reserved_cost_eur`, `ceiling_cost_eur`, `budget_reservations` og `gateway_calls`.

| Situation | Svar |
| --- | --- |
| Ingen/forbudt route | `403` — direkte leverandørkald er forbudt |
| Budget overskredet | `429` med `escalate: true` |
| Idempotency-konflikt / igangværende | `409` |
| Leverandør-timeout | `504` (delvist forbrug afregnes) |
| Afbrudt kald | `499` (delvist forbrug afregnes) |
| Leverandørfejl | `502` |

## Logning og privatliv

Hvert kald logger metadata: agent, route, provider, model, modelversion, dataklasse, request-digest og forbrug. Rå samtaleindhold logges **aldrig**. For personhenførbare dataklasser gemmes heller ikke modelteksten i idempotens-kvitteringen.

## Egress

Kun gatewayen må kontakte en leverandørvært. `gateway/src/egress.mjs` afviser enhver anden principal og enhver vært uden for allowlisten, og adapteren kalder vagten før hvert kald. GitOps-materialet afviser egress i klyngen:

- `gitops/manifests/dev/model-egress-default-deny.json` — default-deny egress for alle pods,
- `gitops/manifests/dev/model-egress-gateway-allow.json` — kun gatewayens pods må nå leverandørværterne (Cilium FQDN),
- `make model-egress-check` beviser at ingen workload ud over gatewayen bærer leverandørnøgler eller peger på en leverandørvært.

## API

```
POST /v1/chat/completions     (OpenAI-agtig form; stream: true giver SSE)
GET  /v1/usage?agentRef=...   (forbrug pr. agent; budgets=... for holdbare budgetter)
GET  /healthz
```

Request bærer agentens identitet i `x-agent-ref`, dataklassen i `data_class`/`x-data-class` og eventuelt en `idempotency-key`. Svaret bærer `provider`, `model`, `modelVersion` og `dataClass`, så beslutningen kan rekonstrueres (AI Act-transparens).

## Acceptkriterier (2.2 / DKC-012)

- [x] Alle modelkald gennem gatewayen; agent uden route kan ikke nå en model (test + `A-003`).
- [x] Én reel leverandøradapter bag gatewayen; echo bevares til tests (`make gateway-test`).
- [x] Serverstyret route efter kunde og dataklasse; ukendt dataklasse afvises (`make model-gateway-test`).
- [x] Atomisk budgetreservation, max-output, timeout/cancel, afregning og idempotency (`make budget-test`).
- [x] Direkte model-egress fra workloads er blokeret (`make model-egress-check` + netværkstest).
- [x] Rå persondata logges ikke som standard.
