# Agent-runtimen

**Kode:** [`runtime/`](../../runtime)
**Kontrakt:** [`agent-task.schema.json`](../../contracts/agent-task.schema.json), [`agent-manifest.schema.json`](../../contracts/agent-manifest.schema.json)
**Backlog:** 2.3

## Formål

Autonomi inden for en grænse, der kan forsvares. Agenten er en principal med SPIFFE-identitet og just-in-time credentials — ikke en feature i en app med stående rettigheder.

## Grænserne

| Grænse | Hvordan |
| --- | --- |
| Kun deklarerede verber | Enhver handling slås op i manifestets `capabilities`. Ukendt verbum afvises — der findes ingen fri shell. |
| Scope | `target` skal ligge inden for capabilityens `target`. |
| A4 | Ændring af policy, audit-log eller egne rettigheder afvises **før** scope og policy. Intet menneske kan godkende det. |
| Governance | Hver handling spørger PDP. `deny` → stoppet. `allow-with-approval`/A3 uden godkendelser → eskaleret. |
| Dødemandsgreb | Kan PDP **eller** audit-log ikke nås, stoppes agenten. Den fortsætter aldrig uden governance. |
| JIT-credentials | Et credential udstedes pr. opgave med TTL og kontrolleres før hver handling. |
| Budget | Tokens, cost EUR og wall clock. Overskridelse eskalerer. |
| Loop-detektion | Samme fix gentaget mere end `repeatFailureLimit` gange → eskalér. Symptomet er ikke årsagen. |

## Livscyklus

```
agent.task.started → (pr. handling: credential → verbum → A4 → scope → loop →
  policy → godkendelse → evidens → budget → udfør → audit) → agent.task.completed
```

Hver hændelse havner i audit-loggen. Status er en af `completed`, `escalated`, `denied`, `refused` eller `halted`.

## Undgå loop og budgetfælder

- `repeatFailureLimit` (default 3) fra manifestet.
- `budget.maxTokens`, `maxCostEur`, `maxWallClockSeconds` fra manifestet eller opgaven.

## Acceptkriterier (2.3)

- [x] Agent udfører et A1-verbum end-to-end (med audit-spor og JIT-credential).
- [x] Mister PDP → stopper (dødemandsgreb). Mister audit-log → stopper før nogen handling.
- [x] Overskrider budget → eskalerer. Loop → eskalerer.
- [x] Udeklarerede verber og A4-handlinger afvises (10 tests).
