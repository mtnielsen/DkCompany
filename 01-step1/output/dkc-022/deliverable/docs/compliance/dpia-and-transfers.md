# DPIA-screening, aftaler og overførsler

DKC-022. Denne side beskriver de databeskyttelsesbeslutninger som
evidens- og risikoregisteret gør til maskinlæsbare poster. De erstatter ikke en
juridisk vurdering; de gør det synligt, hvor en sådan mangler.

## DPIA-screening

En screening har ét af tre resultater:

- **`required`** — en fuld DPIA er påkrævet; posten skal pege på en
  DPIA-dokumentreference og være vurderet af et navngivet menneske.
- **`not-required`** — screeningen er afgjort af et navngivet menneske, og
  posten må ikke pege på en DPIA.
- **`pending`** — vurderingen udestår. Posten markeres som blokerende, og en
  pilot med persondata kan ikke frigives.

## Databehandleraftaler og underdatabehandlere

Hver aftale har en part, en aftalereference, en navngivet godkender og en liste
af underdatabehandlere. Underdatabehandlerne krydsrefereres mod
`compliance/data-register.json`; en aftale der peger på en ukendt
underdatabehandler afvises.

## Overførselsvurdering

EU-hosting er ikke i sig selv fravær af tredjelandsoverførsel. Hver
underdatabehandler har sin egen vurdering:

- **`present`** — overførslen findes og er dækket af et angivet grundlag (fx
  SCC), vurderet af et navngivet menneske.
- **`absent`** — der er vurderet, at der ikke sker en overførsel.
- **`pending`** — vurderingen udestår og blokerer en pilot med persondata.

## Beslutninger

En åben juridisk eller organisatorisk beslutning er ikke det samme som en
manglende beslutning: den har en ansvarlig person, en begrundelse og et
eksplicit flag der blokerer en persondatapilot. Når beslutningen træffes,
registreres den med navn, rolle, dato og en dokumentreference.

## Referencer

- Register: [`compliance/assurance-register.json`](../../compliance/assurance-register.json)
- Genereret tabel: [`assurance.md`](assurance.md)
- Dataregister: [`docs/spec/data-register.md`](../spec/data-register.md)
- ADR-0029: [dataregister og retention](../adr/0029-dataregister-og-retention.md)
