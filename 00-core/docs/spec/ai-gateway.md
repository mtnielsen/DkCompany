# AI-gatewayen

**Kode:** [`gateway/`](../../gateway)
**Kontrakter:** [`gateway-route.schema.json`](../../contracts/gateway-route.schema.json)
**Backlog:** 2.2

## Formål

Alle modelkald går gennem én gateway. Direkte leverandørkald er forbudt. Det giver budget, logging, modelversionering og leverandørskifte ét sted — og gør "hvilken model traf denne beslutning?" besvarligt at omgå.

## Routing

En agent kan kun nå en model gennem en route, der peger på agentens manifest (`agentRef`). Manglende eller deaktiveret route = ingen modeladgang.

```json
{
  "id": "dummy-ok-upgrader-sonnet",
  "agentRef": "dummy-ok-upgrader",
  "provider": "anthropic",
  "model": "claude-sonnet",
  "modelVersion": "2025-01",
  "maxTokens": 200000,
  "maxCostEur": 25,
  "enabled": true
}
```

`gateway/routes.json` valideres mod skemaet i CI, og konformanscheck `A-003` kræver, at enhver agent har en aktiv route. Uden den kan agenten ikke nå en model.

## API

```
POST /v1/chat/completions     (OpenAI-agtig form)
GET  /v1/usage?agentRef=...   (forbrug pr. agent)
GET  /healthz
```

Request bærer agentens identitet i `x-agent-ref`. Svaret bærer `provider`, `model` og `modelVersion`, så beslutningen kan rekonstrueres (AI Act-transparens).

| Situation | Svar |
| --- | --- |
| Ingen route | `403` — direkte leverandørkald er forbudt |
| Budget overskredet | `429` med `escalate: true` |
| Leverandørfejl | `502` |

## Budgetter

Forbrug akkumuleres pr. agent (`tokens`, `costEur`, `calls`). Er budgettet brugt, afvises næste kald. Runtime eskalerer ved `429` i stedet for at fortsætte.

## Acceptkriterier (2.2)

- [x] Alle modelkald gennem gatewayen; agent uden route kan ikke nå en model (test + `A-003`).
- [x] Budget, logging og modelversionering pr. kald.
- [x] Leverandøren er injiceret og kendt kun af gatewayen; runtimes har en gateway-klient.
