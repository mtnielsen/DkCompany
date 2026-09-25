# ADR-0016: Runtimen verificerer og forbruger godkendelser hos tjenesten

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-005. Runtimen godkendte handlinger ud fra `action.approvals`, altså ud fra et felt kalderen selv kunne skrive. Det er en omgåelse af hele godkendelseskontrollen.

## Kontekst og problemstilling

Agent-task-kontrakten havde et `approvals`-array pr. handling. Runtimen talte `verdict === "approve"` og udførte handlingen, når antallet nåede `decision.requiredApprovals`. To anonyme objekter med `verdict: "approve"` var nok. Der var ingen binding til kunden, miljøet, verbet, målet, diff'en, parametrene eller policy-versionen, og en godkendelse kunne genbruges på en anden ændring. DKC-004 gjorde godkendelser autentiske og ændringsbundne i approval-servicen, men runtimen spurgte aldrig tjenesten.

## Beslutningskriterier

- Runtimen må ikke stole på godkendelsesfelter i den indsendte opgave.
- En beslutning skal verificeres mod præcis den handling, der udføres, og det skal ske umiddelbart før eksekvering.
- En godkendelse må kun kunne forbruges én gang, også når to workers kører samtidigt.
- En utilgængelig approval-service skal stoppe A3 (fail-closed).
- En gyldig godkendelse skal fungere gennem den rigtige tjeneste, ikke en stub.

## Overvejede muligheder

- **Behold `action.approvals` og validér formen.** Fjerner ikke tilliden; kalderen bestemmer stadig indholdet.
- **Lad PDP'en verificere godkendelsen.** PDP'en kender ikke den menneskelige beslutning eller dens binding.
- **Læs godkendelsen fra approval-servicen, men genbrug den frit.** Åbner replay på tværs af kørsler.
- **Verificér bindingen i tjenesten og forbrug beslutningen atomisk lige før handlingen.** Lukker både omgåelsen og replay-vinduet.

## Beslutning

1. `approvals` fjernes fra `agent-task`-kontrakten. En A3-handling bærer i stedet `approvalId`, `executionId`, `changeDigest`, `parameters` og `policyBundleVersion`, og opgaven bærer `tenantId`.
2. Runtimen kalder `approvalVerifier.authorizeExecution(descriptor)` — et approval-ID plus den handling, den er ved at udføre. Tjenesten genberegner den kanoniske binding (DKC-004) og sammenligner med den godkendte beslutning. Mangler `approvalId`, eller er tjenesten ikke konfigureret/utilgængelig, stoppes handlingen.
3. Verifikationen sker **efter** evidens-, budget- og executor-kontrollerne og **umiddelbart før** eksekveringen. Et mislykket bindings-tjek forbruger intet.
4. Forbruget er atomisk: `store.claim` opretter en claim-post med `wx` (eller et in-memory-claim). Kun én worker vinder; den anden får `ok: false`. `decision.consumed` og et `approval.consumed`-auditevent skrives.
5. `runtime/src/clients.mjs` får `createApprovalClient` (in-process service eller HTTP) og `ApprovalUnavailable`, så et netværks-/tjenestefejl bliver et dødemandsgreb.

## Konsekvenser

- **Positive:** Den demonstrerede omgåelse (to anonyme approve-objekter) udfører nul handlinger. Godkendelser kan ikke flyttes til en anden handling, kunde eller diff og kan ikke genbruges. To samtidige workers kan ikke udføre samme ændring to gange. Gyldige godkendelser virker gennem den rigtige tjeneste.
- **Negative:** Agent-task-kontrakten brydes (feltet `approvals` fjernes), og eksisterende opgaver skal omlægges til `approvalId` + binding. Runtimen får en ny afhængighed (approval-tjenesten) i den kritiske vej.
- **Neutrale:** A3-godkendelser er nu en tjenesteinteraktion i stedet for et felt. `merge-check` og `authorizeExecution` deler bindingslogikken.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| Behold `action.approvals` + formvalidering | Ingen ændringer | Kalderen bestemmer godkendelsen |
| PDP verificerer | Én beslutningsvej | Kender ikke den menneskelige beslutning |
| Læs uden forbrug | Simpelt | Replay muligt |
| Serverbinding + atomisk forbrug | Lukker omgåelse og replay | Kontraktbrud, ny afhængighed |

## Mere information

- [`docs/spec/agent-runtime.md`](../spec/agent-runtime.md), [`docs/spec/approval-service.md`](../spec/approval-service.md)
- [ADR-0015](0015-autentiske-godkendelser.md)
- [`runtime/src/runtime.mjs`](../../runtime/src/runtime.mjs), [`runtime/src/clients.mjs`](../../runtime/src/clients.mjs), [`contracts/agent-task.schema.json`](../../contracts/agent-task.schema.json)
