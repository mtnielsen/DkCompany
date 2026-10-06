# Reel overvågning: telemetri, sensorer og alarmer

**Kode:** [`observability/src/telemetry.mjs`](../../observability/src/telemetry.mjs), [`observability/src/sensors.mjs`](../../observability/src/sensors.mjs), [`observability/src/alerts.mjs`](../../observability/src/alerts.mjs)
**Konfiguration:** [`observability/sensors.json`](../../observability/sensors.json), [`observability/alert-rules.json`](../../observability/alert-rules.json)
**Kontrakter:** `telemetry-record`, `sensor-registry`, `alert-rule-set`, `alert-notification`, `security-posture`
**Runbook:** [`docs/runbooks/alerting.md`](../runbooks/alerting.md)
**Backlog:** DKC-017 (afhænger af DKC-009 og DKC-015)

> Dashboards og sikkerhedsfund skal komme fra den kørende installation — med
> tenantadgang, minimering, friskhed og alarmer der har en ejer.

## Formål

Et dashboard er kun så godt som den datakilde, der fylder det. 3.3 genererer
paneler fra modulets SLO, og 3.4 normaliserer scannerfund — men uden en streng
kobling til den kørende installation kan en gammel rapport eller en manglende
sensor fremstå som grøn. DKC-017 indfører den kobling:

```
OTel-collector / scannere / runtime-sensorer
        │  metrics, logs, traces
        ▼
ingestTelemetry ── minimering + tenant ──▶ queryTelemetry (verificeret tenant)
        │
        ▼
sensors.json ── friskhed ──▶ securityPosture ──▶ evaluateAlerts
        │                                              │
        └─────────────── ejer, eskalation, runbook ────┤
                                                       ▼
                                        notifikation (minimeret) → modtager
                                                       │
                                                       ▼
                                              hændelsesforløb (tidslinje)
```

## 1. Telemetri med minimering og tenantadgang

`ingestTelemetry` minimerer hver post, før den kan læses:

- **Hemmeligheder** fjernes overalt (feltnavn og værdimønster) via den fælles
  redaktion fra DKC-009 og erstattes med `[REDACTED]`.
- **Personfelter** i det frie attributsæt erstattes med `[MINIMIZED]`, og deres
  digest bevares i `personalData`, så en sag kan korreleres uden at opbevare de
  rå værdier.
- Et emne (`subject.name`) der ser ud som en rå e-mail/telefon afvises, så
  telemetrien ikke bliver en personprofil.

`queryTelemetry` udleder tenanten fra den **verificerede** principal gennem
`requireTenantContext` (DKC-006). En påstand om en fremmed tenant afvises, og
resultatet filtreres altid på den udledte tenant. Kun en scopet platformrolle
kan læse på tværs, og det markeres i resultatet. En kunde kan derfor ikke se en
andens telemetri.

## 2. Sensorer med kilde og friskhed

`observability/sensors.json` er det kanoniske katalog. Hver sensor har et id, en
`source`, en navngivet `owner`, et `expectedIntervalSeconds`, en `maxAgeSeconds`
og en `runbook`. `make monitoring-check` fejler, hvis en sensor eller regel
peger på en runbook der ikke findes, eller hvis ejerskabet mangler.

`freshnessFor` afgør om en måling er `fresh`, `stale` eller `missing`:

| Friskhed | Betydning | Status |
| --- | --- | --- |
| `fresh` | inden for sensorens maksimale alder | fundets status (`pass`/`partial`/`fail`) |
| `stale` | ældre end den maksimale alder | `stale` — aldrig grøn |
| `missing` | intet tidsstempel eller ingen måling | `missing` — aldrig grøn |

`securityPosture` samler dem. `overall` er den mest alvorlige status, og et
`stale`/`missing` tilsidesætter ethvert `pass`. **Gamle eller manglende
sensordata fremstår derfor ikke som grøn sikkerhedsstatus.**

## 3. Alarmer med ejer, eskalation og runbook

`observability/alert-rules.json` beskriver hver regel med:

- en **ejer** (et navngivet, verificeret menneske),
- en **eskalationsstige** (`afterMinutes` → navngivet menneske, stigende),
- en **runbook** der findes i repoet,
- en **modtager** (lokal testmodtager eller en webhook med en `urlEnv`),
- en **betingelse** over en sensor.

`evaluateAlerts` omsætter en posture til alarmer. `dispatchAlerts` leverer en
minimeret notifikation og skriver en kvittering. `createLocalMailbox` er en
rigtig, fil-bakket modtager til test; `createWebhookTransport` rapporterer
`not-run` uden et konfigureret endpoint — aldrig et falsk `delivered`.

Alarmer dækker blandt andet tjenestefejl (`service-unavailable`), fejlet backup
(`backup-failed`), forældede sikkerhedsdata (`security-data-stale`), logsvigt
(`audit-log-failure`) og fejlet nøglerevokation
(`credential-revocation-failed`).

## 4. Hændelsesforløb uden rå persondata

Hvert alarmforløb er en tidslinje: `alerted → notified → escalated →
acknowledged → resolved`. `appendIncidentEvent` **afviser** en detalje der ser
ud som rå persondata og kræver, at den lægges i `data`, som minimeres. Dermed
kan forløbet dokumenteres bredt, mens rå persondata bliver i den adgangsstyrede
kilde.

## Sådan køres det

```bash
make monitoring-check     # sensorkatalog + alarmregler + runbooks (offline)
make monitoring-test      # telemetri/tenant, friskhed, alarmer og konformans
make monitoring-posture   # byg sikkerhedsstatussen fra kataloget
make monitoring-drill     # fremkald tjenestefejl + backupfejl + forældet sensor,
                          # lever til testmodtager og skriv forløb
```

## Acceptkriterier (DKC-017)

- [x] Metrics, logs og traces tilsluttes med minimering og tenantadgang.
- [x] Scanner- og runtime-sensorer kører med datakilde og friskhed.
- [x] Alarmer har ejer, eskalation og runbook; forløbet dokumenteres.
- [x] Fremkaldt tjenestefejl og backupfejl udløser alarm hos testmodtager.
- [x] En kunde kan ikke se en andens telemetri.
- [x] Gamle eller manglende sensordata fremstår ikke som grøn.
- [x] Alarmens forløb dokumenteres uden at dele rå persondata bredt.

## Grænser

- Der kører **ingen** rigtig Prometheus/Loki/OTel-backend i dette miljø. Hele
  kæden er efterprøvet lokalt, men `integration-monitoring-backend` er **NOT
  RUN**.
- Der er **ingen** pager- eller webhook-konto. Den lokale, fil-bakkede
  testmodtager er en rigtig modtager, men en rigtig kanal
  (`integration-alert-delivery`) er **NOT RUN**.
- Se [`docs/status/implementation-matrix.md`](../status/implementation-matrix.md)
  for den præcise status pr. check.
