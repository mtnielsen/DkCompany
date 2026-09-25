# Runbook — CRM med entydigt ejerskab af kundedata

Denne runbook beskriver den menneskelige drift af CRM. Platformen afgør selv
tenant, rolle og klarering før indhold, behandler hver post med en stabil
tenantafgrænset reference og et entydigt ejerskab, og lader tværgående sletning
følge ejerskab, legal hold og retention også i kopier.

## Roller

| Rolle | Ansvar | Kilde |
| --- | --- | --- |
| Platform Owner | Kilder, ejerskab, roller og retention | `crm/sources.json`, `crm/policy.json` |
| Solution Architect | Kandidatvurdering og -godkendelse | `contracts/examples/integration-candidate.espocrm.example.json` |
| Salgsleder | Ejerskab af virksomheder, kontakter og salgsforløb | Identitetsudbyderen (roller) |
| Sikkerhedsansvarlig | Injagt om kundelækage og slettefejl | `docs/security/threat-model.md` |
| Data Protection Officer | Legal hold og sletteanmodninger | `retention/` |

## Drift

1. **Kandidat.** Bekræft at den valgte kandidat (EspoCRM) har OIDC-SSO, et
   dokumenteret REST-API og en dedikeret database pr. tenant. En kandidat må
   ikke erklæres godkendt, så længe en nødvendig egenskab er ukendt eller en
   gendannelse ikke er testet.
2. **Kilder og ejerskab.** Bekræft at hver kilde har en secretreference, et
   ejerskabsfelt og en standardejer, og at rollerne dækker de rette
   entitetstyper. `make crm-check` afviser en rå hemmelighed eller en post uden
   ejerskab.
3. **Import og retry.** En import kræver en idempotency-nøgle. Et retry
   returnerer den samme post. En dublet på forretningsidentitet opdaterer den
   eksisterende post; er det en anden upstream-post, oprettes en konflikt der
   kræver et menneske — flet aldrig automatisk.
4. **Rollebeskyttelse.** Et salgsteam ser kun sin egen tenants CRM. En
   fortrolig post kræver en tilsvarende klarering, og en rolle der ikke må læse
   en entitetstype nægtes.
5. **Sletning.** En sletning kræver ejerskab eller skriveadgang i samme tenant,
   blokeres af et legal hold og rammer primær, aktiviteter, indeks, kopier og
   backup. En WORM-låst backupkopi opgives med udløb. Kør `make crm-run` for den
   deterministiske kontrol.
6. **Backup og gendannelse.** Butikken kan snappes og gendannes; en
   gendannelse bevarer poster og aktiviteter. Verificér med `make crm-run`.

## Kontrolpunkter

- Et salgsteam må ikke kunne læse en anden kundes CRM.
- Et retry må ikke skabe en dublet, og dublerede forretningsposter må ikke
  flettes automatisk.
- Hver post skal have et entydigt ejerskab og en stabil tenantafgrænset
  reference.
- En sletning må ikke efterlade persondata i aktiviteter, indeks eller kopier
  uden en ærlig resterende-kopi-rapport.

## Noter

- Rapporten er en deterministisk model (`measured: false`). En målt integration
  mod en levende EspoCRM og en menneskelig kandidatgodkendelse er `make crm-live`
  og er **NOT RUN**.
