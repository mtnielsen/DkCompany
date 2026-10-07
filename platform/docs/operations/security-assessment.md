# Drift — sikkerhedsvurdering og assessment-gates (DKC-065)

## Formål

Beskrive hvordan platformsteamet forbereder, kører og vedligeholder den
uafhængige sikkerhedsvurdering, og hvordan produktionsgaten håndhæves.

## Roller

| Rolle | Ansvar |
| --- | --- |
| Platform Owner | Ejer engagementet og træffer den menneskelige releasebeslutning. |
| Security Owner | Ejer fund, afhjælpningsfrister og undtagelser. |
| Implementer | Kører den lokale regressionsharness og retter fund. |
| Uafhængig assessor | Udfører den uafhængige vurdering og retest. Må ikke være implementer. |

## Forberedelse

1. Opdatér `security-assessment/rules-of-engagement.json` med mål, identiteter,
   teknikker, tidsvindue, udelukkelser, rate limits, stopbetingelser,
   nødkontakter og evidenshåndtering.
2. Et forberedt engagement (`preparationOnly: true`, `authorization.approved:
   false`) autoriserer kun lokal, syntetisk regression. Levende test kræver en
   særskilt, navngivet scope-godkendelse.
3. Opdatér dækning og kør harnessen:

   ```bash
   make security-assessment-run
   make security-assessment-write   # opdaterer vurdering + rapport
   make security-assessment-check
   ```

## Uafhængig vurdering og import

1. Den uafhængige assessor rapporterer fund i sit eget format. Importér og
   bind til artefaktet:

   ```bash
   node security-assessment/src/cli.mjs import \
     --findings <raw-findings.json> \
     --retests <raw-retests.json> \
     --out security-assessment/assessment.json
   ```

2. Importen redigerer secrets/persondata, bevarer proveniens og markerer et
   retest af et andet artefakt som `artifactChanged`.
3. Registrér den uafhængige vurdering i
   `security-assessment/assessment.json` (`independentAssessment`) med assessor,
   metode, gyldighedsvindue og artefaktbinding. En implementør må ikke være
   assessor.
4. Hvis artefaktet er ændret efter vurderingen, registrér en `impactReview` fra
   det vurderede til det aktuelle artefakt.

## Produktionsgate

```bash
make security-assessment-gate     # BLOCKED så længe vurderingen er udestående
make security-assessment-report   # redigeret rapport
```

Gaten er `blocked`/`outstanding` indtil:

- engagementet er gyldigt og scope aktivt,
- alle ni dækningskategorier består,
- ingen blokerende fund er åbne,
- en frisk, artefaktbundet uafhængig vurdering findes,
- et navngivet menneske har godkendt releasen.

## Bevis og adgang

- Rå evidens er klassificeret `confidential` og adgangskontrolleret.
- Rapporter redigeres og indeholder hverken tokens eller persondata.
- `integration-pentest-independent` er en **NOT RUN** integration: den kræver
  en rigtig assessor og et godkendt eksternt scope.

## Fejlsøgning

| Symptom | Handling |
| --- | --- |
| `security-assessment-check` fejler på "ude af trit" | Kør `make security-assessment-write`. |
| Gaten melder `assessment-artifact-changed` | Registrér en `impactReview`, eller gennemfør en ny vurdering. |
| Harnessen nægter at køre | Kontrollér engagementets tidsvindue og målautorisation. |
| Dækningskategori `failed` | Ret fundet, kør retest og opdater vurderingen. |
