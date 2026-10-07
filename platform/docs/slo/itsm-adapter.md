# SLO: ITSM-adapteren (GLPI)

> DKC-044. Målene er foreslåede og afventer menneskelig vedtagelse.

- **Tilgængelighed:** 99,9 %
- **Latency p95:** 350 ms for adapterens egne kald
- **Fejlbudget:** 0,1 % af 30 dage

## Måling

- Adapteren måler sin egen svartid, incidentkorrelation og eskalationsforsinkelse;
  GLPI's SLO og fejlbudget ligger hos upstream-drift og er ikke adapterens ansvar.
- `health` er `degraded`, når upstream-versionen ikke forhandles, og
  `unavailable`, når GLPI-ping fejler.
- **Kvitteringsfrist** måles fra incidentens oprettelse til den menneskelige
  kvittering og følger SLA'ens `responseMinutes` pr. alvorlighed. En manglende
  kvittering tæller i fejlbudgettet og eskalerer til næste menneske.
