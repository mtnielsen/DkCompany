# ADR-0054 — Kundeportal og kundelivscyklus med én fælles autorisation

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-24
- **Beslutningsdrev:** DKC-025. ADR-0013/0017 gjorde tenanten til den bærende
  afgrænsning, ADR-0015 gjorde godkendelser autentiske og ændringsbundne,
  ADR-0024 gjorde eksekvering genoptagelig og idempotent, og ADR-0005 gjorde
  git til den eneste ændringskanal. Det mangler en samlet indgang, hvor en
  kunde kan oprettes, bestille versionerede servicepakker og afvikles med et
  revisionsspor, og hvor UI og API håndhæver de samme rettigheder.

## Kontekst og problemstilling

Kunden møder i dag platformen gennem flere separate flader: godkendelser,
drift, konfiguration og afvikling. Det giver tre konkrete risici:

- **Rettigheder driver fra hinanden.** Hvis den server-renderede UI og JSON-API'et
  vurderer roller og tenant-scope forskelligt, kan en bruger se eller ændre noget
  i den ene flade, som den anden afviser.
- **Uigennemsigtig bestilling.** Uden en versioneret servicepakke med pris og
  konsekvenser kan en kunde bestille noget, hvis driftspris og
  databehandlingskonsekvenser først viser sig bagefter.
- **Dobbeltressourcer ved delvis fejl.** En provisionering, der fejler midtvejs
  og genoptages, kan oprette den samme ressource to gange, hvis trinnene ikke er
  idempotente.

## Beslutningskriterier

- Én autorisationsmotor for UI og API, default-deny og med eksplicit
  tenant-scope for platformroller.
- Kun verificerede mennesker; demo- og workload-identiteter afvises.
- Versionerede servicepakker med pris og væsentlige konsekvenser, som kunden ser
  og kvitterer for før bestilling.
- En livscyklus med hash-kædet revisionsspor og to-personers-kontrol af
  irreversible handlinger.
- Genoptagelig, idempotent provisionering med deterministiske ressource-ID'er.
- En kunde kan bestille, provisioneres, suspenderes og afvikles — også på et
  holdbart lager.

## Overvejede muligheder

- **A: En tynd UI oven på eksisterende API'er, uden fælles autorisation.** Hurtig,
  men UI og API kan drive fra hinanden, og kravet om samme rettigheder opfyldes
  ikke.
- **B: Kun API, ingen server-rendered UI.** Enklere, men "én indgang" og
  tilgængelighed (dansk/engelsk, tastatur, tydelige fejl) efterlades til senere.
- **C: Et selvstændigt `portal/`-modul med én autorisationsmotor, versionerede
  servicepakker, en hash-kædet livscyklus og genoptagelig provisionering på et
  holdbart SQLite-lager.** Flere komponenter, men hvert acceptkriterium bliver
  efterprøveligt.

## Beslutning

Vi vælger **C**. `portal/` er den ene indgang:

1. **Én autorisation** (`portal/src/authorization.mjs`): `decidePortalAccess`
   læses af både UI og API. En platformrolle kræver rollen og en eksplicit
   scope; en påstået tenant afvises.
2. **Versionerede servicepakker** (`portal/service-packages/*.json`) med pris,
   delpriser og konsekvenser. `orderPreview` beregner driftsprisen server-side,
   og en væsentlig konsekvens skal kvitteres.
3. **Kundelivscyklus** (`portal/src/lifecycle.mjs`) med hash-kædet revisionsspor,
   begrundelseskrav og to-personers afvikling.
4. **Genoptagelig provisionering** (`portal/src/provisioning.mjs`) med
   idempotency-keys og deterministiske ressource-ID'er.
5. **Holdbarhed** (`persistence/migrations/0013_portal_lifecycle.sql`,
   `persistence/src/adapters/portal.mjs`), så livscyklussen og provisioneringen
   overlever en genstart.
6. **Samme testmatrix og baseline** som resten af platformen: kontrakter i
   `contracts/`, semantik i `conformance/src/portal.mjs`, checks i
   `tools/baseline/registry.mjs`.

## Konsekvenser

- Et nyt selvstændigt modul og fire nye tenant-tabeller. Det ændrer SBOM'en, og
  `make supply-chain-sbom` skal køres.
- Et rigtigt SSO-login og en rigtig browser-/tastaturgennemgang kan ikke køres i
  dette miljø og registreres ærligt som `integration-portal-sso` og
  `integration-portal-browser` (NOT RUN).
- En kunde kan nu oprettes, bestille og afvikles med et revisionsspor, og et
  delvist fejlet forløb kan genoptages uden dobbeltressourcer.

## Relaterede ADR'er

- ADR-0005 — Git er den eneste ændringskanal
- ADR-0013 — Fælles kontrolplan med kundeadskilte app-instanser
- ADR-0015 — Godkendelser er autentiske og bundet til den præcise ændring
- ADR-0017 — Tenant udledes af verificeret kontekst og bæres af ressource-ID'er
- ADR-0024 — Genoptagelige job med leases, idempotency-keys og dead-letter
- ADR-0053 — Evidens- og risikoregister med menneskelige beslutninger
