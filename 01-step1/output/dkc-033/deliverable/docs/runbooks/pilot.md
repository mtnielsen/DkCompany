# Runbook: Pilotforløb og readiness

Denne runbook beskriver, hvordan pilotforløbet (DKC-033) gennemføres og
afsluttes for en ny virksomhedsprofil, og hvordan en `not-ready`-tilstand
håndteres.

## Forudsætninger

- Den valgte installationsprofil er understøttet, og installations- og
  releaseacceptancen (DKC-062) er grøn for den.
- Sikkerhedsvurderingen (DKC-065) og recovery-øvelsen (DKC-016/042) kan læses.
- Der er udpeget en navngivet ejer for hver af de tre virksomhedsprofiler.

## Trin

1. **Tilføj eller opdater virksomhedsprofilen** i `pilot/business-profiles.json`.
   Angiv segment, størrelse, installationsprofil, tenant, roller, integrationer
   (med ærlig tilgængelighed) og de seks kritiske arbejdsgange.
2. **Tilføj de seks scenarier** i `pilot/pilot-scenarios.json`, ét pr. arbejdsgang,
   med en navngivet menneskelig ejer og et forventet udfald.
3. **Tilpas readiness-politikken**, hvis den nye profil har andre gates. HA-mål
   må kun være aktive for den erklærede HA-profil.
4. Kør `make pilot-run` og `make pilot-test`. Alle 18 scenarier skal bestå, og
   abuse-proberne skal være rene.
5. Kør `make pilot-render` og commit rapporten sammen med ændringerne.
6. Kør `make pilot-check`, `make validate` og `make release-check`.

## Afslutning af piloten

For at erklære piloten `ready` skal alle aktive, obligatoriske gates være
`passed`:

- `security`: sikkerhedsvurderingen skal være `eligible` med en gyldig
  uafhængig vurdering.
- `quality`: alle scenarier skal bestå, og abuse-proberne skal være rene.
- `recovery`: restore-arbejdsgangene skal bestå, og RPO/RTO skal ligge inden for
  målene.
- `human-assessment`: en uafhængig menneskelig vurdering og en navngivet
  kundcaccept skal være registreret.
- `ha` (kun HA-profilen): HA-plan og serviceklasser skal være efterprøvet.
- `cost`: omkostningen skal være målt eller modelleret.
- `observation`: 30-dages observationen skal være afsluttet.

Registrér observationen i `pilot/observation.json` og kundcaccepten i
`pilot/customer-acceptance.json`. Begge er menneskelige begivenheder.

## Håndtering af `not-ready`

1. Læs `gates[].status` og `gates[].reasons` i
   `pilot/report/pilot-readiness-report.json`.
2. For `pending`-gates: afgør, om evidensen kan fremskaffes nu, eller om den
   afhænger af et menneske eller af kalendertid. Bloker ikke den lokale
   udvikling unødigt, men skjul ikke tilstanden.
3. For `failed`-gates: behandl sikkerheds- og kundeisolationstab som en
   hændelse jf. `docs/runbooks/incident-response.md`.
4. Kør `make pilot-render` efter enhver ændring og commit rapporten.

## Eskalering

- **Sikkerheds- eller isolationstab** → Security Owner jf.
  `docs/runbooks/incident-response.md`.
- **Manglende uafhængig vurdering** → Platform Owner jf.
  `docs/release/security-assessment.md`.
- **Manglende kundcaccept** → den pågældende profils ejer
  (Platform/Service/Enterprise Delivery Owner).
- **HA-mål i fare** → Service Delivery Owner jf. `docs/runbooks/ha-failover.md`.

## Bevis

- `pilot/report/pilot-readiness-report.json`
- `docs/pilot/readiness-report.md`
- `make pilot-run`/`make pilot-test`-loggen
- Observasions- og acceptregistrene
