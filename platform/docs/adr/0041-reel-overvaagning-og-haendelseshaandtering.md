# ADR-0041 — Reel overvågning: tenantadskilt telemetri, friskhed og handlingsdygtige alarmer

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-23
- **Beslutningsdrev:** DKC-017 skal tilslutte faktisk metrics, logs og traces, køre scanner- og runtime-sensorer med datakilde og friskhed, og sikre at alarmer har ejer, eskalation og runbook. Et dashboard eller en grøn prik uden en frisk, tenantadskilt datakilde er ikke overvågning.

## Kontekst og problemstilling

Dashboards (3.3) og sikkerhedsfund (3.4) findes, men de er genereret fra
manifester og committede samples. Der mangler den strenge kobling mellem
**den kørende installation** og det, en operatør ser: telemetri skal minimeres
og tenantadskilles, sensordata skal mærkes med kilde og friskhed, og en alarm
skal have en navngivet ejer, en eskalationsstige og en runbook. Et forældet
scannerfund må ikke fremstå som grøn sikkerhedsstatus, og et hændelsesforløb må
kunne deles bredt uden at lække persondata.

## Beslutningskriterier

- Telemetri (metric/log/trace) minimeres ved indsamling: hemmeligheder fjernes,
  personfelter erstattes, og kun en digest bevares.
- Tenant udledes af den verificerede kontekst; en kunde kan ikke læse en andens
  telemetri, og krydskunde-læsning kræver en scopet platformrolle.
- Hver sensor har en navngivet ejer, et forventet interval, en maksimal alder og
  en runbook; kataloget er den kanoniske kilde.
- `pass` for en sikkerhedsstatus kræver friskhed; `stale`/`missing` er ikke-grøn.
- En alarm leveres til en modtager og bærer ejer, eskalation, runbook og kun en
  minimeret observation.
- Hændelsesforløbet dokumenteres, og rå persondata afvises i det brede spor.

## Overvejede muligheder

- **A:** Lade hvert dashboard/scanner erklære sin egen status og alarm uden en
  fælles sensormodel.
- **B:** Kun vise en grøn/rod prik og overlade alarmering til et eksternt system.
- **C:** Et fælles sensorkatalog, en tenantadskilt telemetri-strøm med
  minimering, en friskhedsregel der gør `stale`/`missing` ikke-grønne, og
  alarmregler med ejer/eskalation/runbook og en minimeret notifikation.

## Beslutning

Vi indfører (C). `contracts/telemetry-record.schema.json`,
`contracts/sensor-registry.schema.json`, `contracts/alert-rule-set.schema.json`,
`contracts/alert-notification.schema.json` og
`contracts/security-posture.schema.json` beskriver kontrakterne.
`observability/src/telemetry.mjs` minimerer og tenantadskiller;
`observability/src/freshness.mjs` og `observability/src/sensors.mjs` udleder
status; `observability/src/alerts.mjs` evaluerer, leverer og fører forløb.
`conformance/src/monitoring.mjs` håndhæver minimering, ejerskab, friskhed og den
ikke-grønne regel.

### Konsekvenser

- **Positive:** En grøn sikkerhedsstatus og en alarm hviler på en frisk,
  tenantadskilt og navngivet kilde; persondata holdes ude af brede kanaler.
- **Negative:** En rigtig Prometheus/Loki/OTel-backend og en rigtig pager-/
  webhook-kanal findes ikke i dette miljø og er NOT RUN.
- **Neutrale:** Den lokale, fil-bakkede testmodtager bruges til at efterprøve
  hele kæden offline.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Lidt fælles kode | Inkonsistent friskhed, ingen fælles tenantgrænse |
| B | Simpelt | Alarmer uden ejer/eskalation/runbook; grøn uden friskhed |
| C | Fælles, verificerbar kæde fra sensor til modtager | Kræver en rigtig backend/kanal for fuldt driftsbevis |

## Mere information

- `docs/spec/monitoring.md`
- `docs/runbooks/alerting.md`
- `observability/src/telemetry.mjs`, `observability/src/sensors.mjs`, `observability/src/alerts.mjs`
- ADR-0009 (kontrolmapping), ADR-0010 (dashboards fra manifest), ADR-0011 (sikkerhedsfund), ADR-0034 (evidensmodes)
