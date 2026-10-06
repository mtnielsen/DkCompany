# Runbook — support og sagsbehandling

Denne runbook beskriver den menneskelige drift af support og sagsbehandling.
Platformen afgør selv tenant og kø-ACL før indhold, behandler vedhæftninger som
ubetroet data og kræver en menneskelig godkendelse før afsendelse og lukning.

## Roller

| Rolle | Ansvar | Kilde |
| --- | --- | --- |
| Platform Owner | Kilder, køer, SLA og retention | `helpdesk/sources.json`, `helpdesk/policy.json` |
| Support Manager | Godkender svar og lukning | `helpdesk/src/approval-gate.mjs` |
| Support Agent | Behandler sager inden for egen kø | Identitetsudbyderen (kø-grupper) |
| Sikkerhedsansvarlig | Injagt om injektionsfund og rettighedsforsøg | `docs/security/threat-model.md` |
| Den eksterne kunde | Ser kun egne sager | Identitetsudbyderen |

## Drift

1. **Kilder og køer.** Bekræft at hver Zammad-kilde har en secretreference, at
   køerne har en klassifikation og en ACL, og at `externalVisible` er sat
   korrekt. `make helpdesk-check` afviser en rå hemmelighed eller en kø uden
   ACL eller SLA.
2. **Indgang.** En mail eller webformular bliver én sag med en idempotent
   message-id. En post til en ukendt kø afvises (`unknown_queue`); opret køen i
   `helpdesk/sources.json` eller omdirigér posten.
3. **Vedhæftninger.** Hvert bilag scannes. Et fund markeres i sagens
   `injectionFindings`, sættes i karantæne og kan ikke ændre rettigheder.
   Eskalér til den sikkerhedsansvarlige ved gentagne fund.
4. **AI-udkast.** AI'en klassificerer og udkaster. Udkastet er ubetroet og
   ikke-eksekverbart. Et udkast har et `draftDigest`; ændres indholdet, holder
   en tidligere godkendelse ikke.
5. **Godkendelse og afsendelse.** En Support Manager godkender udkastet
   (`recordReplyApproval`), hvorefter agenten sender det (`sendReply`). Uden en
   gyldig godkendelse sendes intet. Lukning er ligeledes godkendelsespligtig.
6. **Eksport, sletning og retention.** En DSAR-eksport samler mails, bilag og
   indeks. En sletning sker fladvis (mail, bilag, indeks) og efterlader en
   tombstone. Et legal hold blokerer sletning. Kør `make helpdesk-run` for den
   deterministiske kontrol.
7. **Backup og gendannelse.** Butikken kan snappes og gendannes; en
   gendannelse bevarer sager og historik. Verificér med `make helpdesk-run`.

## Kontrolpunkter

- En ekstern kunde må ikke se en anden kundes eller tenants sag.
- En vedhæftning må ikke ændre rettigheder eller blive et værktøjskald.
- Et AI-udkast må ikke sendes uden en gyldig, ændringsbunden godkendelse.
- En slettet sag må ikke ligge aktiv i mail, bilag eller indeks efter retention.

## Noter

- Rapporten er en deterministisk model (`measured: false`). En målt integration
  mod en levende Zammad er `make helpdesk-live` og er **NOT RUN**.
