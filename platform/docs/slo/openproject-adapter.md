# SLO: projektstyringsadapteren (OpenProject)

> DKC-027. Målene er foreslåede og afventer menneskelig vedtagelse.

- **Tilgængelighed:** 99,9 %
- **Latency p95:** 400 ms for adapterens egne kald (ekskl. store import/eksport)
- **Fejlbudget:** 0,1 % af 30 dage

## Måling

- Adapteren måler sin egen svartid, fejlrate og projektionens friskhed; OpenProjects
  SLO og fejlbudget ligger hos upstream-drift og er ikke adapterens ansvar.
- `health` er `degraded`, når upstream-versionen ikke forhandles, og
  `unavailable`, når ping fejler.
- En retrieval der afvises som `stale_projection` tælles som en
  korrekthedshændelse, ikke som en fejl, men den indgår i overvågningen af
  rettighedsprojektionens friskhed.
