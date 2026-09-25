# Drift: enterprise- og branchepakker (DKC-036)

## Kommandoer

| Kommando | Formål |
| --- | --- |
| `make enterprise-check` | Validér pakkekatalog, kapabilitetsregister, sikkerhedskontrakter og rapportens synkronisering. |
| `make enterprise-test` | Kør model-, resolver-, gate-, prioriterings-, scaffold- og konformanstestene. |
| `make enterprise-run` | Kør den deterministiske gate-kontrol og vis hver pakkes blokeringer. |
| `make enterprise-render` | Skriv `enterprise/report/enterprise-package-report.json` og `docs/enterprise/enterprise-package-report.md`. |
| `make enterprise-report` | Vis rapporten på stdout. |
| `make enterprise-scaffold` | Vis scaffold-kommandoen for en ny branchepakke. |
| `make enterprise-live` | NOT RUN — kræver en underskrevet testkundeaftale og en bekræftet faglig/sektor-/AI-vurdering. |

## Hvad driften skal se på

1. **Ingen implementerbar pakke.** Rapporten skal vise `implementable: false` og
   mindst én blokering for hver pakke, indtil testkundens aftale er underskrevet
   og hver blokerende faglig vurdering er bekræftet af et navngivet menneske.
   En `implementable: true` med blokeringer er en fejl.
2. **Fælles sikkerhedskontrakter.** `summary.sharedSecurityContracts` skal være
   sand. Hvis en størrelsesprofil ændrer sin `securityCore`, fejler
   `enterprise-check`.
3. **Ingen automatiske byggeopgaver.** `catalogOnlyNotBuildTasks` lister de
   katalogposter, der endnu ikke er byggeopgaver. `buildBacklog` er tom, indtil
   en eksplicit, menneskeligt godkendt ordre findes.
4. **Højrisiko-AI er særskilt.** `regulated-care` har `highRiskAi.applicable:
   true` og skal forblive `required`/`pending`, indtil en særskilt vurdering er
   bekræftet.
5. **Uafklarede kapabiliteter.** `field-service` og `manufacturing` viser
   `missing` kapabiliteter, som kataloget endnu ikke udstiller. Det er en ærlig
   blokering, ikke en skemafejl.

## Ændring af en pakke

En pakke ændres i `enterprise/packages.json`. En ny pakke bør oprettes med
scaffolden:

```bash
node enterprise/src/scaffold.mjs new min-branche --out /tmp/min-branche
```

Kør derefter `make enterprise-render`, `make enterprise-check`,
`make enterprise-test`, `make validate` og `make release-check`. En ændring af
`enterprise/capabilities.json` kræver, at registeret fortsat svarer til
komponentmanifesterne.

## Ændring af et fagligt krav

Et fagligt krav må kun gå fra `unreviewed`/`pending` til `confirmed`, når:

- `reviewer` er et navngivet menneske (`oidc|navn`),
- `reviewedAt` er sat, og
- `evidence` henviser til et konkret dokument.

Det gælder også `sectorRules` og `highRiskAi`. En `confirmed` vurdering uden et
navngivet menneske og et tidspunkt afvises af `enterprise-check`.

## Forholdet til release og baseline

`REQ-ENTERPRISE-001` binder `enterprise-check/test/run/report` og
`integration-enterprise-live` i release-matricen. `integration-enterprise-live`
er ekstern og registreres som NOT RUN. `enterprise-profiles` er en komponent i
`tools/baseline/registry.mjs`.
