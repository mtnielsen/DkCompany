# Bølge 6: økonomi, HR og handel

Denne bølge registrerer de næste forretningsmoduler i kataloget. Den bygger på
`BACKLOG.md` bølge 4.2 (yderligere moduladaptere) og på pilotbehovene fra
DKC-033. **Ingen adapter bygges i denne bølge** — registreringen gør dem klar
til særskilte, afgrænsede opgaver.

## Valgt rækkefølge

| # | Familie | Kandidat | Status | Næste skridt |
| --- | --- | --- | --- | --- |
| 1 | Økonomi/ERP | Tryton 7.0.0 | `pending-legal-review` | Faglig afklaring af dansk bogføring og moms; derefter adapterissue. |
| 2 | Fakturering | Invoice Ninja 5.11.0 | `pending-legal-review` | Afklaring af e-faktura-access point (OIOUBL/NemHandel). |
| 3 | HR | Frappe HR 15.42.0 | `pending-legal-review` | Navngivet lønansvarlig og revideret lønproces. |
| 4 | Tid | Kimai 2.30.0 | `registered` | Adapterissue kan oprettes; ingen lovbestemt lokalisering. |
| 5 | Handel/webshop | Medusa 2.7.0 | `pending-legal-review` | Moms og godkendt betalingstjeneste før aktivering. |

Kandidaterne er teknisk rangeret, men ikke menneskeligt godkendte
(`candidate_not_approved`).

## Discovery-issue og adapterissues

- **Ét discovery-issue** dækker den fælles afklaring: dansk bogføring, moms,
  e-faktura, løn, betaling/bank, aftaler og autoritative registre. Det ejes af
  Service Owner og kræver en navngivet revisor/bogholder og en lønansvarlig.
- **Ét adapterissue pr. valgt produkt** oprettes først, når discovery har
  afgjort den relevante gate. Et katalogprodukt bliver ikke automatisk til en
  bestilt byggeopgave.

## Fravalg

| Fravalg | Begrundelse |
| --- | --- |
| Egen bogføringsmotor | Parallelt ERP-produkt med dansk bogføringslov som vedvarende ansvar. |
| Egen e-faktura-afsendelse | NemHandel/OIOUBL kræver et godkendt access point. |
| Lønberegning i platformen | Juridisk reguleret; kræver en navngivet lønansvarlig. |
| Egen betalingsformidling | PCI-DSS; BACKLOG udskyder det eksplicit til en ekstern tjeneste. |
| Fuldt ERP på `small-vps` | En lille VPS har ikke kapaciteten; familierne ligger i HA- og enterprise-profilerne. |

## Ikke mål i denne bølge

- Faktiske adaptere og produktionsdata.
- En påstand om danskklaret regnskab eller løn.
- En godkendt betalingstjeneste.

Alle tre er NOT RUN og kræver et navngivet menneske eller en ekstern kilde.
