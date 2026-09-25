# ADR-0043 — Tværgående IAM og dataadgang for Communications, HR, BI og Reporting

- **Status:** accepteret
- **Beslutningstagere:** Security Owner, Service Owner
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-060 kræver, at de valgfrie funktionspakker bruger de samme sikkerhedsprincipper helt ned til data og eksport. Uden en fælles, default-deny motor for ressource-, række- og feltadgang bliver tenantgrænsen og HR-følsomme felter afhængige af hver enkelt applikation, og et almindeligt SSO-login kan fejlagtigt bruges som bevis for downstream-autorisation.

## Kontekst og problemstilling

Communications, HR, BI og Reporting er selvstændige funktionspakker med hvert
sit formål. De læser de samme typer data gennem forskellige flader — UI, API,
connector, søgning, eksport, cache og AI-værktøj — og har planlagte rapporter
og afviklingsforløb. Konkret skal:

- en BI-bruger ikke kunne læse løn- eller helbredsfelter uden en udtrykkelig
  HR-bevilling,
- skemalagte rapporter stoppe eller revalideres, når afsenderens eller en
  modtagers rettigheder bortfalder, uden at genbruge et creator-token,
- offboarding lukke sessioner, API-tokens, delinger, planlagte workflows og
  AI-værktøjsbevillinger inden en frist,
- en connector ikke lave vilkårlige forespørgsler med admin-credentials,
- Reporting kunne installeres mod en ekstern HR-kilde uden at installere hele
  HR- eller Communications-applikationen,
- et SSO-login alene ikke accepteres som bevis for downstream-autorisation.

En skjult UI-knap er ikke en kontrol, og en grøn enhedstest er ikke et
driftsbevis.

## Beslutningskriterier

- Feltadgang er default-deny; beskyttede klasser kræver en eksplicit bevilling.
- Den samme beslutning håndhæves på alle syv flader.
- Tenant udledes af den verificerede principal, ikke af et klientfelt.
- Rapporter revaliderer afsender og alle modtagere ved kørsel og afsendelse.
- Offboarding er idempotent, holdbar og fristbundet.
- Connectoren afviser rå SQL og admin-credentials.
- Formålene er adskilte, og Reporting afhænger ikke af HR/Communications.

## Overvejede muligheder

- **A:** Lade hver funktionspakke implementere sin egen adgangskontrol.
- **B:** En fælles policy-tjeneste alene, uden en delt ressource-/feltmodel.
- **C:** Funktionsprofiler plus én fælles default-deny motor for ressource-,
  række- og feltadgang, genbrugt af rapportering, offboarding og connectoren.

## Beslutning

Vi indfører (C). `feature-access/profiles/*.json` erklærer de fire
funktionsprofiler med modulvalg, separat formål, dataklasser og feltregler.
`feature-access/src/access.mjs` er den fælles motor. `guests.mjs`,
`service-accounts.mjs`, `offboarding.mjs`, `reporting.mjs` og
`connector-guard.mjs` bygger oven på den. Kontrakterne
`feature-profile.schema.json`, `report-definition.schema.json`,
`report-run.schema.json` og `offboarding-plan.schema.json` beskriver artefakterne,
og `conformance/src/feature-access.mjs` håndhæver beslutningerne.

### Konsekvenser

- **Positive:** Tenantgrænsen og HR-følsomme felter håndhæves ét sted på tværs
  af alle flader; rapporter og offboarding får en fælles, reviderbar model;
  Reporting forbliver installerbar uden HR/Communications.
- **Negative:** En rigtig leveringskanal (SMTP/filshare/portal) og en rigtig
  IdP/tokenudbyder findes ikke i dette miljø og er NOT RUN.
- **Neutrale:** Motoren er en ren, testbar funktion og bruges både fra
  conformance, CLI og en fremtidig API-grænse.

## Fordele og ulemper ved mulighederne

- **A** giver lokal frihed, men spreder tenant- og feltkontrollen og gør
  negative tests per flade umulige at genbruge.
- **B** centraliserer beslutningen, men uden en delt ressource-/feltmodel kan
  fladerne fortolke "samme rettighed" forskelligt.
- **C** deler både beslutning og model, hvilket gør fladeligheden maskinelt
  efterprøvelig.
