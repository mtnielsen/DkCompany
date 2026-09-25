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
| Governance | Hver handling spørger PDP. `deny` → stoppet. `allow-with-approval`/A3 uden gyldigt approval-ID → eskaleret. |
| Godkendelse (DKC-005) | Runtimen stoler ikke på `action.approvals`. Den bruger `approvalId` og verificerer + forbruger beslutningen hos approval-servicen lige før handlingen. |
| Dødemandsgreb | Kan PDP, audit-log **eller approval-service** ikke nås, stoppes agenten. Den fortsætter aldrig uden governance. |
| JIT-credentials (DKC-010) | Et kortlivet, scope-bundet token udstedes pr. handling af en KMS-signerer og verificeres hos modtageren (audience, kunde, ressource, verbum, miljø, TTL). Et lokalt UUID er ikke længere nok. |
| Nødstop (DKC-010) | Et aktivt nødstop pr. agent, pr. kunde eller globalt afviser nye handlinger inden for fem sekunder i staging. Kun et verificeret menneske kan aktivere/ophæve. |
| Budget | Tokens, cost EUR og wall clock. Overskridelse eskalerer. |
| Loop-detektion | Samme fix gentaget mere end `repeatFailureLimit` gange → eskalér. Symptomet er ikke årsagen. |

## Livscyklus

```
agent.task.started → (pr. handling: credential → verbum → A4 → scope → loop →
  policy → approvalId → evidens → budget → executor → verificér+forbrug godkendelse →
  udfør → audit) → agent.task.completed
```

Hver hændelse havner i audit-loggen. Status er en af `completed`, `escalated`, `denied`, `refused` eller `halted`.

## Godkendelser uden bypass (DKC-005)

`action.approvals` er fjernet fra `agent-task`-kontrakten. En handling der kræver
menneske (A3 eller `allow-with-approval`) skal i stedet bære:

| Felt | Betydning |
| --- | --- |
| `approvalId` | ID på den serververificerede beslutning hos approval-servicen |
| `executionId` | Unikt eksekverings-ID (replay-/idempotensnøgle) |
| `changeDigest` | SHA-256 af den diff, handlingen udfører |
| `parameters` | De parametre, handlingen udfører |
| `policyBundleVersion` | Policy-versionen beslutningen blev truffet under |

Rækkefølgen er bevidst: alle andre kontroller (evidens, budget, executor)
gennemføres først, og **umiddelbart før** eksekveringen kalder runtimen
`authorizeExecution` på approval-servicen. Servicen genberegner den kanoniske
binding (kunde, miljø, verbum, mål, diff-digest, parametre, policy-version og
udløb), sammenligner med den godkendte beslutning og reserverer godkendelsen
atomisk. Dermed:

- to anonyme `approve`-objekter udfører nul handlinger;
- en utilgængelig approval-service stopper A3 (fail-closed);
- en godkendelse til en anden handling, kunde eller diff afvises;
- to samtidige workers kan ikke forbruge samme godkendelse.

## Undgå loop og budgetfælder

- `repeatFailureLimit` (default 3) fra manifestet.
- `budget.maxTokens`, `maxCostEur`, `maxWallClockSeconds` fra manifestet eller opgaven.

## Acceptkriterier (2.3)

- [x] Agent udfører et A1-verbum end-to-end (med audit-spor og JIT-credential).
- [x] Mister PDP → stopper (dødemandsgreb). Mister audit-log → stopper før nogen handling.
- [x] Overskrider budget → eskalerer. Loop → eskalerer.
- [x] Udeklarerede verber og A4-handlinger afvises (10 tests).

DKC-005 (se `runtime/test/approval-runtime.test.mjs`):

- [x] To indsendte `approve`-objekter udfører nul handlinger.
- [x] Utilgængelig approval-service stopper A3 (dødemandsgreb).
- [x] Godkendelse til anden handling, anden kunde eller tidligere diff afvises.
- [x] To samtidige workers kan ikke udføre samme godkendte ændring to gange.
- [x] Gyldig godkendelse virker gennem den rigtige approval-service.

## Kortlivede rettigheder og nødstop (DKC-010)

Runtimen udsteder ét kortlivet token pr. handling gennem `credentialBroker`,
bundet til kunde, ressource, verbum, miljø og executor-audience. Modtageren
verificerer tokenet (`credentials/src/receiver.mjs`) og afviser forkert audience,
scope, udløb, tilbagekaldelse og aktive nødstop. Runtimen tjekker nødstoppet før
hver handling og stopper fail-closed. Den tillader heller ikke handlinger mod
policy, audit, credentials, egen registrering eller GitOps (A4).

Se [`credentials.md`](credentials.md) og [`runtime/test/credentials-runtime.test.mjs`](../../runtime/test/credentials-runtime.test.mjs).

- [x] Credential virker kun hos tilsigtet executor og til det tilladte scope.
- [x] Udløb og tilbagekaldelse afviser efterfølgende handlinger hos modtageren.
- [x] Nødstop afviser nye handlinger inden fem sekunder i staging.
- [x] Agenten kan ikke ændre sit eget manifest, deployment eller kontroltjenesters adgang.
