# Målt integration mod en levende Zammad (NOT RUN)

`make helpdesk-live` er **NOT RUN** i dette miljø. Der findes ingen levende
Zammad-installation, intet rigtigt API-token og ingen rigtig
mail-/vedhæftningshændelse at måle imod.

## Hvad der er efterprøvet i stedet

Den rigtige Zammad-adapter, indgangen, kø-routing, adgangsfiltreringen,
vedhæftningsscanningen, godkendelsesgaten, retentionen og backup/gendannelsen
køres deterministisk mod en mock-upstream med en rigtig filbutik:

```bash
make helpdesk-run
make helpdesk-check
make helpdesk-test
```

Det dækker:

- en indgående mail/webformular der bliver én sag fra modtagelse til lukning med
  en append-only historik,
- et retry med samme message-id der ikke skaber en dublet,
- en ekstern kunde der kun ser egne sager, og tenantadskillelse i begge
  retninger,
- en vedhæftning med et skadeligt injektionsforsøg der markeres, sættes i
  karantæne og ikke kan ændre sagens rettigheder eller blive et værktøjskald,
- et AI-udkast der ikke sendes uden en gyldig, ændringsbunden godkendelse,
- eksport, sletning og retention for mails, bilag og indeks, et legal hold der
  blokerer sletning, og en backup/gendannelse der bevarer sager og historik.

## Hvad der udestår

- En faktisk Zammad-installation med et scoped API-token.
- En rigtig indgående mail/webformular og en rigtig vedhæftning fra en ekstern
  afsender.
- En rigtig afsendelse og lukning i upstream gennem adapteren.
- En målt tid fra sletning til sidste kopi (indeks, bilag, backup) er væk.

Indtil da forbliver `integration-zammad-live` NOT RUN, og rapporten erklærer
`measured: false`.
