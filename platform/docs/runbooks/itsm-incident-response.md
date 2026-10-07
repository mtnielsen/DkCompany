# Runbook — Incident-/serviceproces (ITSM, DKC-044)

Denne runbook er den menneskelige procedure for serviceprocessen. Den er
refereret fra `service-registry/services.json` og fra alarmreglernes `runbook`.
Adapteren (`modules/itsm-adapter/`) oversætter platformens verber til GLPI, men
**ansvaret ligger altid hos et navngivet menneske**.

## 1. Alarm → incident

1. En alarm (DKC-017) sendes til `POST /v1/itsm/alarms` med `serviceId` og
   alarmens `id`, `ruleId`, `signal`, `severity`.
2. Adapteren korrelerer alarmen til **én** incident:
   - samme `alertId` giver samme incident (idempotent),
   - samme `serviceId` + `ruleId` + `signal` lægges på den åbne incident,
   - ellers oprettes en ny incident med den vagthavende som ejer og de berørte
     tjenester (tjenesten + transitive afhængigheder).
3. En `sev1`-alarm opretter en **major incident**.

## 2. Kvittering og eskalation

- Enhver alvorlighed kræver menneskelig kvittering inden for
  kvitteringsfristen (SLA'ens `responseMinutes` eller rotationens
  `ackMinutes`).
- Manglende kvittering:
  1. `GET`-bar tilstand via `POST /v1/itsm/incidents/escalate`.
  2. Eskalation til næste menneske i `service-registry/oncall.json`.
  3. **Risikofyldt handling stoppes**, indtil et menneske har kvitteret.
- En AI er aldrig on-call eller eskalationspunkt.

## 3. Major incident

- En major incident må ikke lukkes af en AI.
- Lukning kræver:
  - menneskelig kvittering, **og**
  - en navngiven menneskelig godkendelse.
- Et grønt healthcheck er **ikke** grundlag nok til at lukke alene.

## 4. Problem og kendt fejl

- Gentagne incidents (≥ `problem.repeatThreshold`, standard 3) inden for
  `problem.windowDays` foreslås som et problem via `POST /v1/itsm/problems`.
- Oprettelse kræver en navngiven menneskelig validering; fejler den, afvises
  forslaget, og hændelsen auditeres.
- Den kendte fejl bærer rodårsag og workaround.

## 5. Change

- Et change knytter incident, tjeneste, runbook, godkendelse og audit-ID sammen.
- Kræver runbook, mindst én menneskelig godkendelse og mindst én incident.

## 6. Kundevisning

- Kunden ser kun egne sager og kun kundevendte felter. Ejers identitet og
  interne AI-handlinger er som standard skjult (DKC-044-politikken).

## 7. Roller og agenter

- En serviceproces må bruge flere agenter, men hver agent har præcis **én**
  uforanderlig rolle (DKC-055). En agent må aldrig kombinere roller, og en AI er
  aldrig ejer, godkender eller on-call.
- `POST /v1/itsm/processes/validate` afviser en proces, hvor en agent optræder
  med flere roller.

## 8. Fejltilstande

- Utilgængelig PDP → ingen sag oprettes (fail-closed, HTTP 503).
- Nægtet policy → ingen sag oprettes (HTTP 403).
- GLPI er ikke tilgængelig → health er `unavailable`, og verber svarer 5xx.
