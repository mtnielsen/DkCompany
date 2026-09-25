# Support og sagsbehandling med Zammad som system-of-record

- **Status:** accepteret
- **Beslutningstagere:** Anna Andersen (Platform Owner), Cecilia Christensen (Security Owner)
- **Dato:** 2026-10-03
- **Beslutningsdrev:** DKC-029 kræver, at support og sagsbehandling leverer tickets, prioritet, SLA og kundehistorik med Zammad som første kandidat, at en AI kun udkaster svar (afsendelse er en separat, godkendt handling), og at en ekstern kunde kun ser egne sager.

## Kontekst og problemstilling

Platformen har en fælles adapter-SDK (DKC-023), en værktøjsgrænse og
injektionssignal (DKC-011), sletning/legal hold (DKC-021) og en portal med
kundens livscyklus (DKC-025). Support og sagsbehandling er imidlertid en
indgående, ubetroet kanal: en mail eller webformular kan bære et skadeligt
injektionsforsøg i sin tekst eller i en vedhæftning, og en naiv AI ville kunne
sende et svar eller udvide rettigheder gennem prosa alene. Samtidig må en
ekstern kunde aldrig se en anden kundes sag, og en afsendelse må ikke ske uden
et menneskes godkendelse.

## Beslutningskriterier

- Zammad forbliver system-of-record; platformen spejler sager, køer og historik.
- Adgang er default-deny og tenantadskilt; en ekstern kunde ser kun egne sager.
- En vedhæftning er ubetroet, ikke-eksekverbart indhold og må aldrig ændre
  rettigheder.
- AI må klassificere og udkaste, men afsendelse er en separat handling der
  kræver en gyldig, ændringsbunden menneskelig godkendelse.
- En sag har en append-only historik fra modtagelse til lukning.
- Eksport, sletning og retention dækker mails, bilag og indeks, og et legal hold
  blokerer sletning.

## Overvejede muligheder

- **A:** Lad AI'en både udkaste og sende, og filtrér adgang i UI'et.
- **B:** Gør Zammad til system-of-record bag en adapter, spejl sager i en
  filbaseret butik med epoch og append-only historik, afgør tenant og kø-ACL
  før indhold, pak alt sags- og bilagsindhold som ubetroet, og kræv en
  ændringsbunden godkendelse for afsendelse og lukning.
- **C:** Stol på, at modellen og den enkelte agent respekterer grænserne.

## Beslutning

Vi vælger **B**. `helpdesk/sources.json` beskriver Zammad-kilder med tenant,
secretreference, køer med klassifikation og ACL samt en vedhæftnings- og
retentionpolitik. `helpdesk/src/zammad.mjs` er en tynd adapter mod Zammads API,
og `helpdesk/src/mock-zammad.mjs` er testdobbelen. `helpdesk/src/intake.mjs`
gør en indgående mail/webformular til én sag med idempotens på message-id,
kø-routing, AI-klassifikation og sikker vedhæftning. `helpdesk/src/store.mjs` er
en holdbar filbutik med epoch og en append-only, uforanderlig historik.
`helpdesk/src/permissions.mjs` håndhæver default-deny, tenantadskillelse og at
en ekstern kunde kun ser egne sager. `helpdesk/src/attachments.mjs` pakker hvert
bilag som ubetroet indhold gennem runtimens grænse (DKC-011), scanner for
injektion og afviser enhver patch der forsøger at ændre rettigheder.
`helpdesk/src/classification.mjs` lader AI'en klassificere og udkaste; udkastet
er ubetroet, ikke-eksekverbart og bærer et digest. `helpdesk/src/approval-gate.mjs`
kræver en gyldig, ændringsbunden menneskelig godkendelse før afsendelse og
lukning. `helpdesk/src/retention.mjs` eksporterer, sletter og retentionsstyrer
mails, bilag og indeks og blokerer sletning ved et legal hold. Rapporten
erklærer `measured: false`; den målte integration er `make helpdesk-live` og er
NOT RUN.

### Konsekvenser

- **Positive:** En ekstern kunde kan ikke se andres sager; en vedhæftning kan
  ikke ændre rettigheder eller blive et værktøjskald; et AI-udkast kan ikke
  sendes uden en gyldig godkendelse; historikken og gendannelsen er intakt.
- **Negative:** Køer, SLA og retention skal vedligeholdes, og en målt
  integration mod en levende Zammad mangler stadig.
- **Neutrale:** Support er en ny førstepartsevne i `helpdesk/`; den genbruger
  tenant-konteksten, runtimengrænsen, injektionsscanneren og DKC-021's holds.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Simpelt | Sender uden godkendelse; lækker sager; injektion kan udvide rettigheder |
| B | Afgør adgang før indhold, ubetroet bilag, godkendt afsendelse, ærlig retention | Kræver vedligeholdt spejl og en ekstern målt integration |
| C | Ingen kode | Uacceptabelt; adgang må ikke hvile på en prompt |

## Mere information

- [`docs/spec/support-helpdesk.md`](../spec/support-helpdesk.md), [`docs/helpdesk/helpdesk-report.md`](../helpdesk/helpdesk-report.md), [`docs/helpdesk/zammad-live.md`](../helpdesk/zammad-live.md), [`docs/operations/helpdesk.md`](../operations/helpdesk.md)
- [`helpdesk/sources.json`](../../helpdesk/sources.json), [`contracts/helpdesk-source.schema.json`](../../contracts/helpdesk-source.schema.json), [`contracts/support-ticket.schema.json`](../../contracts/support-ticket.schema.json), [`contracts/reply-draft.schema.json`](../../contracts/reply-draft.schema.json)
- [`docs/adr/0023-vaerktoejsgraense-og-injection.md`](0023-vaerktoejsgraense-og-injection.md), [`docs/adr/0036-faelles-adapter-sdk-og-godkendelsestest.md`](0036-faelles-adapter-sdk-og-godkendelsestest.md), [`docs/adr/0049-sletning-legal-hold-og-gendannelsesregler.md`](0049-sletning-legal-hold-og-gendannelsesregler.md), [`docs/adr/0067-rettighedsbevidst-videnssoegning.md`](0067-rettighedsbevidst-videnssoegning.md)
