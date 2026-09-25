# Begrænset selvreparation med sikker fallback

DKC-046. En AI må genoprette service **inden for menneskegodkendte rammer** og
skal standse sikkert ved usikkerhed. `runtime/src/remediation.mjs` er en
deterministisk orkestrator — ikke én flerrolleagent.

## State machine

```
detect → correlate → diagnose → propose → policy/approval → durable intent
       → execute → verify → recovered
                          ↘ rolled_back
                          ↘ escalate
                          ↘ halt (fail-closed)
```

| Trin | Rolle | Handling |
| --- | --- | --- |
| detect | observer | En hændelse/alarm indlæses. |
| correlate | observer | Deduplikér mod aktive forløb og leases. |
| diagnose | observer/planner | AI-diagnose (kan fejle på modeludfald). |
| propose | planner | Foreslå runbook + parametre. |
| policy/approval | platform | PDP + menneskelig godkendelse/pre-approval. |
| durable intent | platform | Skriv intentionen før nogen ekstern ændring. |
| execute | executor | Udfør gennem den rigtige runtime. |
| verify | verifier | Uafhængig verifikation + health-observation. |
| rollback/fallback | executor | Kun autoriseret rollback; ellers stop. |

Ulovlige overgange afvises (`allowedRemediationTransition`).

## To initiale runbooks

Kun `stateless-restart@1.0.0` og `bounded-scale@1.0.0` er aktiveret. Begge er
signerede, versionsstyrede runbooks med lukket scope, parameterrammer,
forudsætninger, maksimal påvirkning, udløb, forsøgsgrænse, testet rollback og
postchecks. Enhver anden handling kræver **særskilt evidens** og afvises ellers.

## Ressourcelease, cooldown og budget

- `createResourceLease` giver en atomisk lease pr. ressource med monotonisk
  `fencingToken` og cooldown efter frigivelse. To agenter kan ikke reparere
  samme ressource samtidigt, og en frigivet ressource kan ikke overtages før
  cooldown er udløbet.
- `createRemediationBudget` deler forsøg, fejl og ændringer mellem alle agenter
  pr. ressource inden for et tidsvindue.

## Healthchecks og observationstid

`observeHealth` sampler et brugerflows-healthcheck over et observationsvindue.
Så snart en måling er under `baseline - tolerance` (eller en boolsk check er
falsk), er observationen degraderet og forløbet stopper — og der rulles kun
tilbage, hvis handlingen er reversibel og rollbacken er autoriseret.

## Foruddefinerede fallback-handlinger

`createSafeFallback` kører kun `pause`, `read-only` og `isolation` — handlinger
der **reducerer** adgang, ikke udvider. De er valgt på forhånd af et navngivet
menneske og kræver hverken model eller live PDP, så de kan køre, når
AI-ændringer er stoppet.

## Reversibilitet

`describeReversibility` klassificerer verbet via den fælles
handlingsklassifikation. `migrate`, `migrate.schema` og `restore` er
**irreversible**: de har ingen kompensation og falder til `stop-and-escalate`.
En plan eller et change må ikke beskrive dem som generelt reversible.

## Rolleadskillelse

`assertRoleSeparation` kræver, at detector, planner, executor og verifier er
adskilte identiteter. Verifikationen må ikke udføres af producenten eller
eksekvereren. Orkestratoren koordinerer; identiteterne bærer rollerne.

## Fail-closed

- Tab af audit, PDP eller approval stopper nye agentmutationer.
- Modeludfald under diagnose/forslag stopper AI-ændringer
  (`aiChangesStopped: true`) og kører en sikker fallback.
- Nødstop (DKC-010), A4 og AI-immutable (DKC-048) håndhæves fortsat af
  runtimen.

## Checks

```bash
make remediation-check   # skema + state machine + reversibilitet + lease + health
make remediation-test    # orkestrator mod den rigtige runtime/change-service
```

## Grænser

- En distribueret låsetjeneste på tværs af noder er en ekstern integration
  (NOT RUN). Den filbaserede lease virker mellem processer på samme host.
- En rigtig model og en rigtig health-probe er separate integrationer.
- Orkestratoren er deterministisk; den udfører ikke selv en shell eller en
  mutation.
