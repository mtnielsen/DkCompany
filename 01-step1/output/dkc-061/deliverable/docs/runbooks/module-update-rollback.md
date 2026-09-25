# Runbook: afbrudt eller fejlet modulopdatering

Denne procedure dækker en opdatering startet med
`installer/src/lifecycle-update.mjs`. Planen er signeret, resumabel og har en
snapshot-baseret rollback.

## Forudsætninger

- Den signerede `LifecycleUpdatePlan` og dens digest er kendt.
- Et snapshot blev taget før den første mutation (`snapshotRef`).
- En navngiven, verificeret person kan godkende de resterende muterende trin.

## Trin

1. **Standse og vurdere.** Et fejlet trin står i planens `steps` med `state:
   failed` og fejlårsag.
2. **Genoptag idempotent.**
   ```bash
   node installer/src/lifecycle-cli.mjs execute-update <fra> <til>
   ```
   Allerede fuldførte trin springes over. Afhængigheder kontrolleres før hvert
   trin.
3. **Hvis genoptagelse ikke er mulig, rul tilbage.** `rollbackUpdate` gendanner
   snapshot-tilstanden og sætter den forrige release aktiv igen.
4. **Verificér** at release, komponenter og records matcher den forrige
   tilstand, og at ingen delvise mutationer består.
5. **Registrér** hændelsen med plan-digest, snapshot, årsag og den godkendende
   person.

## Stopbetingelser

- Signaturen kan ikke verificeres.
- Snapshot mangler eller er beskadiget.
- Et muterende trin mangler menneskelig godkendelse.
- Målreleasen er ikke længere `stable`/`security`.

Ved en stopbetingelse må opdateringen ikke fortsætte; rul tilbage eller eskalér
til Platform Owner.
