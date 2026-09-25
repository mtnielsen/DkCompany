# Drift af pilotforløbet

Denne side beskriver, hvordan pilotforløbet (DKC-033) køres og vedligeholdes i
drift. Den kanoniske kilde er `pilot/`, `pilot/readiness-policy.json` og
`docs/spec/pilot.md`.

## Kommandoer

| Kommando | Formål |
| --- | --- |
| `make pilot-run` | Kør de 18 scenarier, abuse-proberne og den afgrænsede belastningstest |
| `make pilot-check` | Validér profiler, scenarier, politik og rapportens synkronisering |
| `make pilot-render` | Skriv `pilot/report/pilot-readiness-report.json` og `docs/pilot/readiness-report.md` |
| `make pilot-report` | Vis rapporten som JSON |
| `make pilot-test` | Kør pilot- og konformanstestene |
| `make pilot-live` | Kræver en levende serviceprofil, en 30-dages observation og en navngivet kundcaccept (NOT RUN) |

## Rutine

1. Kør `make pilot-run` efter en ændring i en af de moduler, scenarierne kalder
   (identity, feature-access, approvals, backup, privacy, installer,
   migration).
2. Kør `make pilot-render`, hvis rapporten ændrer sig, og commit begge filer.
3. Kør `make pilot-check` og `make pilot-test`. En aktiv gate der skifter fra
   `passed` til `pending`/`failed`, skal undersøges — ikke skjules.
4. Kør `make release-check`, fordi `REQ-PILOT-001` og `THREAT-PILOT-001` indgår i
   release-materialet.

## Gate-status i drift

- **`passed`** — evidensen findes, er frisk og opfylder kriteriet.
- **`pending`** — evidensen findes, men er udestående (fx en uafsluttet
  observation eller en manglende kundcaccept). Det er en ærlig tilstand.
- **`not-run`** — evidenskilden mangler helt. Undersøg hvorfor.
- **`failed`** — evidensen findes og opfylder ikke kriteriet. Blokerer
  `ready`.

`ready` opstår kun, når hver aktiv, obligatorisk gate er `passed`.

## Kundcaccept og observation

Den 30-dages observation og kundeaccepten registreres særskilt:

- `pilot/observation.json` — periode, `observedDays`, `startedAt`, `endedAt` og
  `evidenceRef`. En afsluttet observation skal dække alle 30 dage og have et
  sluttidspunkt i fortiden.
- `pilot/customer-acceptance.json` — en liste af accepter, hver med et navngivet
  menneske i en accepteret rolle og en gyldig dato. Et tomt register betyder
  `pending`, ikke `passed`.

Et menneske i en accepteret rolle skal registrere accepten; en implementør eller
en grøn kørsel kan ikke gøre det.

## Fejlfinding

| Symptom | Handling |
| --- | --- |
| `pilot-check` siger "ude af trit" | Kør `make pilot-render` og genkør |
| En gate er `not-run` | Kontrollér at evidensfilen findes, og at stien i `readiness-policy.json` er rigtig |
| En gate er `failed` | Læs `reasons` i rapporten; ret årsagen eller accepter den ikke |
| Abuse-probe finder en omgåelse | Behandl som en sikkerhedshændelse jf. `docs/runbooks/incident-response.md` |

## Grænser

`make pilot-live` er NOT RUN i dette miljø: der findes ingen levende
serviceprofil, ingen 30-dages driftsperiode og ingen navngivet kundcaccept. En
grøn deterministisk kørsel er ikke en erklæring om produktionsparathed.
