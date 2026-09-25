# ADR-0042 — Autoriseret telemetri-API med udskiftelige dashboards

- **Status:** accepteret
- **Beslutningstagere:** Security Owner, Platform Owner
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-017 tilsluttede telemetri, friskhed og alarmer lokalt, men der manglede en fælles, authentificeret læse-/skrivevej til dashboards og eksterne systemer. Uden stabile ressource-ID'er, server-side scope og read-only adapters bliver tenantgrænsen afhængig af hvert dashboard, og et forældet signal kan fremstå som grønt.

## Kontekst og problemstilling

Drifts- og assurance-data kommer fra mange kilder: OTel metrics/logs/traces,
scannerfund, testkørsler, backup-/gendannelsesøvelser og agenthandlinger.
Dashboards skal kunne vise dem samlet, men:

- en tenant må ikke kunne se eller indtage en andens data gennem API, cache,
  link eller AI-værktøj,
- scope må ikke kunne sættes af klienten,
- sene, dublerede, replayede, malformede eller utroværdige hændelser må ikke
  forfalske pass/godkendelse/healthy,
- et collectornedbrud eller overload skal følge dokumenterede grænser, og tab af
  drifts-telemetri må ikke deaktivere den obligatoriske audit,
- en dashboard-adapter skal kunne udskiftes uden at ændre forretningsmoduler.

## Beslutningskriterier

- Én versioneret envelope for alle signaler; fund/test/recovery har separate
  strukturerede kontrakter.
- Stabile ressource-ID'er og relationer på tværs af tjeneste, miljø, tenant,
  version, deployment, ændring, incident, alarm og trace.
- Autentificeret indtagning udleder scope server-side; krydskunde kræver en
  scopet platformrolle.
- Read-only adaptere og AI-værktøjer med eksplicit view-scope.
- Friskhed, retention, kardinalitet, paginering, redaktion, dedup og
  backpressure er eksplicitte.
- Audit har sin egen holdbare vej og påvirkes ikke af telemetritab.

## Overvejede muligheder

- **A:** Lade hvert dashboard læse direkte fra hver kilde.
- **B:** Én delt database som alle dashboards læser rå fra.
- **C:** Et authentificeret telemetri-API med én envelope, stabile ID'er,
  server-side scope, tenant-scopede views og udskiftelige read-only adaptere.

## Beslutning

Vi indfører (C). `contracts/telemetry-envelope.schema.json` m.fl. beskriver
kontrakterne. `telemetry-api/` implementerer indtagning, lager, autorisation,
views, query, adaptere, collectore og en HTTP-server. `conformance/src/telemetry-api.mjs`
håndhæver semantikken.

### Konsekvenser

- **Positive:** Tenantgrænsen håndhæves ét sted, uanset om data læses gennem API,
  cache, link eller AI; dashboards kan udskiftes; friskhed og provenance er
  maskinelt kontrolleret.
- **Negative:** En rigtig OTel/Prometheus-backend og en rigtig Grafana/Loki-instans
  findes ikke i dette miljø og er NOT RUN.
- **Neutrale:** Den lokale HTTP-server bruges til at efterprøve kæden end-to-end
  offline.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Ingen fælles kode | Inkonsistent scope, let at lække mellem tenants |
| B | Simpelt | Rå data til alle; ingen autorisation eller minimering |
| C | Fælles, verificerbar og udskiftelig | Kræver en rigtig backend/instans for fuldt driftsbevis |

## Mere information

- `docs/spec/telemetry-api.md`
- `telemetry-api/`, `conformance/src/telemetry-api.mjs`
- `contracts/telemetry-envelope.schema.json`, `contracts/dashboard-view.schema.json`, `contracts/dashboard-adapter.schema.json`
- ADR-0017 (tenant-kontekst), ADR-0034 (evidensmodes), ADR-0041 (reel overvågning)
