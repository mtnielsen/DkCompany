# Målt AI-drift mod levende model og staging (NOT RUN)

`make shadow-live` er den målbare kørsel, der endnu **ikke** er udført. Replayet
i `docs/ai-operations/shadow-report.md` er en deterministisk model med
`measured: false`. Det er ikke det samme som en målt kørsel.

## Hvad der allerede er efterprøvet

- Motoren i `shadow/src/shadow.mjs` kører de rigtige invarianter: nul mutation i
  skyggetilstand, staging-only og reversibilitet for begrænset autonomi.
- Runbook-scope og -parametre valideres med `approvals/src/runbook.mjs`.
- Nødstop og governance kontrolleres fail-closed før enhver muterende handling.
- Replay-datasættet er anonymiseret og indeholder ground truth, modelobservation
  og den menneskelige beslutning.

## Hvad der mangler, og hvorfor

| Manglende ressource | Konsekvens |
| --- | --- |
| Levende model-/gateway-endpoint | De faktiske modelforslag, falske alarmer og omkostning er ikke målt mod en rigtig model. |
| Isoleret stagingklynge | Den udførte effekt er simuleret (`simulated: true`); en rigtig mutation er ikke observeret. |
| Menneskelige godkendere | Den menneskelige beslutning i datasættet er historisk/syntetisk, ikke en ny, bindende godkendelse. |
| Ekstern audit-/WORM-lagring | Den målte kørsel er ikke arkiveret uden for platformen. |

## Procedure når miljøet findes

1. Bind en levende model og en isoleret stagingklynge til gatewayen.
2. Kør replayet mod den levende model og gem den målte rapport som ekstern
   evidens:

   ```sh
   make shadow-live
   ```

3. Sammenlign de målte falske alarmer, fejl, eskalationer, omkostning og
   reviewerfund med bevillingens tærskler.
4. En udvidelse af autonomien kræver fortsat en versionsstyret ejerbeslutning med
   gentaget evidens; den må ikke godkendes af agenten selv.

Den målte kørsel skal vise `shadow.mutationCount = 0` for skyggetilstanden og
kun udføre forhåndsgodkendte, reversible runbooks i staging.
