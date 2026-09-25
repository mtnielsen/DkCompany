# Danske lokaliseringsgates (DKC-035)

Denne side beskriver, hvordan dansk bogføring, moms, e-faktura, løn, betaling,
aftaler og autoritative registre er gjort til **særskilte gates** i
modulregistreringen. Den er en redegørelse — ikke en compliance-attestation.

> Repoet er **ikke** "compliant software". Det er et sæt kontroller og et
> sporbarhedsapparat, som en udgiver eller driftsorganisation kan bruge til at
> dokumentere sine egne forpligtelser. En faktisk dansk bogføring, momsangivelse
> eller lønudbetaling kræver en navngivet fagperson.

## Gate-model

| Krav | Blokerer 'Danmarksklar' | Nødvendigt bevis |
| --- | --- | --- |
| `accounting` | ja | Registreret revisor/bogholder bekræfter kontoplan, bilagsførsel, momsafregning og årsafslutning. |
| `vat` | ja | Dansk momsfagperson bekræfter satser, EU-varekøb, omvendt betalingspligt og angivelse. |
| `e-invoicing` | ja | Godkendt access point for OIOUBL/NemHandel og en dokumenteret adresseringsvej. |
| `payroll` | ja | Navngivet lønansvarlig bekræfter skattetræk, ATP, pension, feriepenge og eIndkomst. |
| `payment` | ja | Godkendt ekstern betalingstjeneste, en databehandleraftale og en scope-liste uden fuld bankadgang. |
| `agreements` | nej | Databehandler- og ansvarsaftaler for eksterne tjenester. |
| `authoritative-registers` | nej | Verificeret kilde til CVR/Erhvervsstyrelsen og vilkår for genbrug. |

Et krav er kun `confirmed`, når `reviewedBy` er et navngivet menneske,
`reviewedAt` er sat, og `evidence` henviser til et konkret dokument. I dette
miljø er intet krav `confirmed`, så **ingen familie er danskklar**.

## Dataejerskab og -klasser

Hver katalogkomponent erklærer sine data-klasser i `localization.dataClasses`:

- `finance`, `invoicing` og `payment`: `financial` og (for de to første)
  `personal`.
- `hr`: `personal`, `special-category` og `financial`.
- `time`: `personal`.
- `webshop`: `personal` og `financial`.

Finansielle data er omfattet af `legalReviewRequired` på de relevante
adaptergrænseflader. Personale- og lønnedata må ikke behandles uden en
databehandleraftale.

## Betaling og bankadgang

`payment-bank` er den eneste grænseflade med `externalServiceRequired: true`.
Den forbyder eksplicit `bank:full-access`, `accounts:full-access`,
`payments:admin` og `cards:read`. Platformen gemmer aldrig kortdata.
`approvedExternalServiceRef` er `null`, så gaten er `pending`.

## Kontrolreferencer

Kravet `REQ-LOCALIZATION-001` er bundet til kontrolreferencerne `cm-2`
(baselinekonfiguration), `si-12` (informationshåndtering og retention) og `au-9`
(beskyttelse af auditinformation) i `compliance/control-mapping.json`. Truslen
`THREAT-LOCALIZATION-001` ligger på grænsen `external-sources`.

## Hvad der ikke er gjort

- Ingen faglig afgørelse af bogføring, moms, e-faktura eller løn.
- Ingen godkendt betalingstjeneste eller aftale.
- Ingen adapter er bygget eller målt.

Alle fire er NOT RUN og kræver en ekstern kilde eller et navngivet menneske.
