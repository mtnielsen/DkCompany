# Sektorregler og højrisiko-AI for branchepakker (DKC-036)

Branchepakker må ikke bruge en teknisk grøn check som en faglig, juridisk eller
sikkerhedsmæssig godkendelse. Dette dokument beskriver, hvordan
`enterprise/packages.json` skiller de to, og hvilke vurderinger der forbliver
uafklarede input.

## Faglige krav

Hvert fagligt krav i `professionalRequirements` har:

- en `authority` (hvem der kan godkende),
- en `status` (`unreviewed`/`pending`/`confirmed`/`not-applicable`),
- `blocksImplementation`, og
- ved `confirmed`: et navngivet `reviewer`, et `reviewedAt` og mindst ét
  `evidence`.

Et ubekræftet, blokerende krav gør pakken ikke-implementerbar. En
`confirmed` status uden et navngivet menneske, et tidspunkt og et bevis afvises
af `enterprise-check`.

## Sektorregler

`sectorRules` angiver de regelsæt, pakken er omfattet af, og om der findes en
særskilt vurdering. `required` og `pending` blokerer implementering.
`not-applicable` kræver ingen vurdering.

| Pakke | Sektorregimer | Status |
| --- | --- | --- |
| `enterprise-core` | — | `not-applicable` |
| `retail-commerce` | forbrugeraftaler | `required` |
| `field-service` | arbejdsmiljø | `required` |
| `manufacturing` | maskinsikkerhed, produktsikkerhed | `required` |
| `regulated-care` | sundhedsret, databeskyttelse | `required` |

## Højrisiko-AI

`regulated-care` har `highRiskAi.applicable: true`. Det er en
højrisiko-anvendelse efter AI Act og kræver en særskilt vurdering. Vurderingen
er knyttet til [`compliance/assurance-register.json`](../../compliance/assurance-register.json)
(`REQ-AIACT-001`, kontrol `au-2`) og forbliver `required`, indtil et navngivet
menneske har bekræftet den med et tidspunkt. `enterprise-check` afviser en
`highRiskAi` der står `confirmed` uden et navngivet menneske og et tidspunkt.

## Særlige kategorier af persondata

`regulated-care` behandler `special-category`-data. Det kræver mindst
`enhanced` isolation; pakken bruger `dedicated` med dedikerede databaser,
netværkssegmentering og immutable audit. Adgang følger den samme default-deny
politik og tenantadskillelse som resten af platformen.

## Hvad der er NOT RUN

- En underskrevet testkundeaftale.
- En bekræftet faglig vurdering af dansk bogføring, moms, e-faktura og løn.
- En bekræftet sektorvurdering for handel, feltservice, produktion og regulerede
  brancher.
- En bekræftet højrisiko-AI-vurdering.

Disse kræver et navngivet menneske eller en ekstern kilde og registreres ikke
som standardværdier. Se `make enterprise-live`.
