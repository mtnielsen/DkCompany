# Runbook: onboarding af en enterprise- eller branchepakke (DKC-036)

Dette runbook beskriver, hvordan en ny branchepakke går fra katalogpost til en
bestilt byggeopgave **uden** at forke kontrolplanet. Alle trin er menneskelige
beslutninger; koden fejler lukket, indtil de er registreret.

> Dette er et dokumentations-runbook. `make runbook-check` læser
> `runbooks/*.json`, ikke denne fil.

## Forudsætninger

- En størrelsesprofil fra `catalog/profiles/` er valgt og har den fælles
  sikkerhedskerne.
- Kapabiliteterne i pakken findes i `enterprise/capabilities.json`, eller de
  uafklarede kapabiliteter er accepteret som en blokering.
- Der er udpeget en **navngivet produktejer** og en **navngivet
  testkundekontakt**.

## Trin 1 — Opret pakken med scaffolden

```bash
node enterprise/src/scaffold.mjs new <pakke-id> \
  --title "<titel>" \
  --segment enterprise \
  --base-profile enterprise-dedicated \
  --owner-name "<navn>" --owner-subject "oidc|<subject>" \
  --customer "<Testkunde A/S>" --contact-name "<navn>" --contact-subject "oidc|<subject>" \
  --out /tmp/<pakke-id>
```

Scaffolden validerer mod skemaet og modellen og skriver først, når pakken er
konsistent. Flyt den derefter ind i `enterprise/packages.json` og kør
`make enterprise-render`.

## Trin 2 — Beskriv dataejerskab og isolation

- Hver dataklasse har en navngiven ejer, et formål, en residens og en
  retentionreference.
- Særlige kategorier af persondata kræver mindst `enhanced` isolation.
- Pakken arver profilen; den må ikke fjerne eller erstatte sikkerhedskernen.

## Trin 3 — Afklar faglige krav, sektorregler og højrisiko-AI

- Hvert blokerende fagligt krav står `unreviewed`/`pending`, indtil en navngivet
  fagperson har godkendt det med et tidspunkt og et bevis.
- Sektorregler kræver en særskilt vurdering.
- Hvis pakken aktiverer AI-beslutningsstøtte, sættes `highRiskAi.applicable:
  true` med en særskilt vurdering. Den kan ikke bekræftes uden et navngivet
  menneske.

## Trin 4 — Testkunden

`testCustomer.status` er `identified`, indtil der findes en underskrevet aftale.
En syntetisk testkunde kan **ikke** stå som `consented`. Først når aftalen
findes, sættes `contractRef`, `status: "consented"` og `synthetic: false`.

## Trin 5 — Bestilling og byggeopgave

En katalogpost bliver først en byggeopgave, når:

- testkundens aftale er underskrevet,
- alle blokerende faglige/sektor-/AI-vurderinger er bekræftet,
- pakken er eksplicit godkendt med en `orderRef`, et navngivet `approvedBy` og et
  `approvedAt`, og
- `make enterprise-run` viser `implementable: true`.

`buildBacklog` udledes kun af en sådan ordre. Ellers forbliver komponenterne
katalogposter.

## Verifikation

```bash
make enterprise-check
make enterprise-test
make enterprise-run
make enterprise-render
make validate
make validate && make lint
make release-check
```

En grøn teknisk check er ikke en faglig godkendelse. Den menneskelige aftale og
vurdering er særskilt NOT RUN (`make enterprise-live`).
