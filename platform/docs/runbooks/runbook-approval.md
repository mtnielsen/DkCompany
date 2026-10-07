# Runbook: godkendelse og aktivering af en runbook

Denne runbook beskriver, hvordan en signeret runbook bliver forhåndsgodkendt og
aktiveret, og hvordan en normal- eller emergency-change gennemføres uden at omgå
menneskelig autorisation eller A4/AI-immutable-grænserne.

## 1. Forbered og signér runbooken

```bash
# Skriv runbooken som JSON efter contracts/runbook.schema.json og signér den.
RUNBOOK_SIGNING_KEY="<fra KMS/HSM — aldrig i Git>" \
  node runbooks/sign.mjs runbooks/min-runbook.json runbook-signing > /tmp/signed-runbook.json

# Validér signatur og semantik.
node --no-warnings conformance/src/runbook-check.mjs
```

En runbook uden gyldig signatur, med utestet rollback, åbent parameterskema
eller udløb i fortiden afvises.

## 2. Godkend runbookversionen (standard change)

1. Opret en almindelig godkendelsesanmodning i approval-servicen
   (`POST /v1/approvals`) med `change.verb = "runbook.approve"`,
   `change.runbook.sha256 = <runbook-digest>` og `change.targets` lig
   runbookens scope-mål.
2. Lad mindst det antal **verificerede mennesker** godkende, som politikken
   kræver (fx to, og aldrig selv-godkendelse).
3. Bind godkendelsen til versionen:

```js
import { createChangeService } from "./approvals/src/change-service.mjs";
const change = createChangeService({ approvalService, runbookKeyring, calendar });
change.registerRunbook(signedRunbook);
change.approveRunbook({ runbookRef: "patch-dummy-ok@1.0.0", approvalId: "APR-..." });
```

En `pending`-, `expired`- eller no-objection-beslutning kan ikke blive en
pre-approval. En ny version eller et større scope kræver en ny godkendelse.

## 3. Udfør en standard-change

Runtimen resolver runbookversionen server-side og overskriver enhver
klientmedsendt digest. Er pre-approvalen gyldig, kører handlingen uden en ny
godkendelse pr. mutation — men kun inden for scope, parameterramme, udløb og
forsøgsgrænse.

## 4. Normal change

Uden en gyldig pre-approval kræver hver mutation en konkret, ændringsbundet
godkendelse. Runtimen kræver et `approvalId` og verificerer det gjennem
approval-servicen lige før eksekvering.

## 5. Emergency change

Emergency kræver en særskilt autorisation:

1. Opret en godkendelsesanmodning med `change.verb = "runbook.emergency"`,
   `change.emergency = true` og `change.runbook.sha256 = <digest>`.
2. Lad en incident-commander godkende eksplicit.
3. Giv `emergencyAuthorization.approvalId` til resolveren.

Emergency forbruges pr. mutation. Den kan ikke slå A4- eller
AI-immutable-kontrollerne fra; de kører uafhængigt i runtimen.

## 6. Afslutning

Postchecks kører efter handlingen. En fejlende postcheck med
`onFailure: "rollback"` udfører den testede rollback og markerer changen
`rolled_back`. Låsen på målet frigives altid.

## Fejlsøgning

| Symptom | Årsag | Handling |
| --- | --- | --- |
| `runbooken er ikke signeret` | Klienten sendte ugyldig version | Signér med den rigtige nøgle. |
| `uden for runbookens scope` | Forkert mål/miljø/verbum | Ret scope eller brug en ny godkendelse. |
| `parameteren ... er ikke tilladt` | Parameter uden for skemaet | Ret parameteren. |
| `er låst af en anden change` | Samtidig change på samme mål | Afvent, eller koordinér i change-kalenderen. |
| `postchecks fejlede` | Rollback kørt | Undersøg rollback-resultatet og eskaler. |
