# SLO: arbejdspladsadapteren (Nextcloud)

> DKC-026. Målene er foreslåede og afventer menneskelig vedtagelse.

- **Tilgængelighed:** 99,9 %
- **Latency p95:** 400 ms for adapterens egne kald (ekskl. store filoverførsler)
- **Fejlbudget:** 0,1 % af 30 dage

## Måling

- Adapteren måler sin egen svartid og fejlrate; upstream Nextclouds SLO og
  fejlbudget ligger hos upstream-drift og er ikke adapterens ansvar.
- `health` er `degraded`, når upstream-versionen ikke forhandles, og
  `unavailable`, når ping fejler.
