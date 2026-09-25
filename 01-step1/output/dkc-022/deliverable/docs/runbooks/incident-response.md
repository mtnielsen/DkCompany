# Runbook — hændelseshåndtering og indberetning

DKC-022. Denne runbook beskriver, hvordan en sikkerheds- eller
persondatabrudshændelse håndteres, dokumenteres og indberettes. Selve
beslutningen om anmeldelse og kommunikation er en menneskelig handling og kan
ikke automatiseres.

Registerets indberetningspligter og ejere findes i
[`compliance/assurance-register.json`](../../compliance/assurance-register.json)
og beskrives i [`docs/compliance/incident-access-exit.md`](../compliance/incident-access-exit.md).

## 1. Konstatér og klassificér

- Sikr forløbet: alarm, audit-spor og korrelations-ID'er indsamles uden at dele
  rå persondata bredt.
- Klassificér hændelsen: driftsforstyrrelse, fortrolighedsbrud, integritetsbrud
  eller tilgængelighedsbrud.
- Afgør om persondata er berørt, og om der er risiko for de registreredes
  rettigheder.

Klassificeringen er en menneskelig vurdering. En alarm er ikke en afgørelse.

## 2. Indberetningsfrister

| Regime | Frist | Modtager | Ejer |
| --- | --- | --- | --- |
| GDPR art. 33 | 72 timer | tilsynsmyndigheden | Platform Owner |
| NIS2 art. 23 | 24 timer (tidlig advarsel) | CSIRT | Security Owner |

Fristerne regnes fra det tidspunkt, hvor hændelsen blev kendt. En manglende
indberetning er i sig selv et registerbrud.

## 3. Beslutning om anmeldelse og kommunikation {#indberetning}

Et navngivet menneske træffer beslutningen om:

- anmeldelse til tilsynsmyndighed/CSIRT,
- underretning af berørte kunder og registrerede,
- offentlig kommunikation.

Beslutningen, begrundelsen og tidspunktet dokumenteres. Hvis beslutningen er
"ikke anmeldelsespligtig", skal begrundelsen stadig dokumenteres. Den faktiske
brudøvelse og beslutningen er **NOT RUN** i dette miljø; registeret bærer
proceduren og ejeren.

## 4. NIS2 {#nis2}

NIS2 art. 23 kræver en tidlig advarsel inden 24 timer, en hændelsesrapport
inden 72 timer og en endelig rapport inden en måned. Security Owner er ansvarlig
for, at tidsstemplerne og indholdet bevares.

## 5. Efterbehandling

- Opdatér risikoen i evidens- og risikoregisteret.
- Gennemfør en adgangsrevision hvis bruddet involverede adgang.
- Følg op i [`docs/compliance/incident-access-exit.md`](../compliance/incident-access-exit.md).

## 6. Evidens

- `make assurance-check` — register og indberetningspligter.
- `make assurance-export` — samlet evidenspakke med menneskelige beslutninger.
- `make monitoring-drill` — fremkaldt tjenestefejl/backupfejl giver alarm.
