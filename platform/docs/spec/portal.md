# Kundeportal og kundelivscyklus (DKC-025)

Portalen er virksomhedernes **eneste indgang** til platformen. Den giver
verificeret SSO, appoversigt, roller, godkendelsesindbakke, driftsstatus og
forbrug samt kontrolleret bestilling og afvikling af versionerede
servicepakker. Administrative ændringer går gennem godkendte GitOps-flows.

Koden ligger i `portal/`, kontrakterne i `contracts/` og det holdbare lager i
`persistence/src/adapters/portal.mjs` med migration
`persistence/migrations/0013_portal_lifecycle.sql`.

## Én autorisation for UI og API

Kravet er, at UI og API **håndhæver samme rettigheder**. Derfor findes der kun
én beslutningsfunktion, `decidePortalAccess` i `portal/src/authorization.mjs`:

- **Default-deny.** En ukendt handling, en manglende rolle eller en manglende
  tenant-scope afvises.
- **Kun verificerede mennesker.** Demo- og workload-identiteter afvises; et
  rigtigt SSO-login er en forudsætning.
- **Tenant udledes af principalen**, aldrig af et felt klienten kan sætte.
- **En platformrolle kræver både rollen og en eksplicit scope**
  (`platform-operator:acme`, `platform-admin:*` eller et signeret
  `tenantScope`). Rollen alene giver ingen adgang.
- Den server-renderede UI (`portal/src/render.mjs`) og JSON-API'et
  (`portal/src/server.mjs`) kalder begge denne funktion for samme handling,
  principal og tenant.

Rolle- og handlingskataloget ligger i `portal/src/constants.mjs` og er
maskinelt kontrolleret af `make portal-check`: hver handling skal have mindst
én rolle og et kendt scope.

## Versionsstyrede servicepakker

En servicepakke (`portal/service-packages/*.json`,
`contracts/service-package.schema.json`) er en versioneret, kundevendt samling
af moduler med:

- en **pris** (månedlig og implementering) med delpriser,
- en række **konsekvenser**, hvoraf mindst én er `material`,
- **databehandling** (persondata og underdatabehandlere), og
- en **supportprofil** og en bestillingsbar livscyklus.

Kunden ser den forventede driftspris og hver konsekvens **før** bestillingen
(`orderPreview`, `make portal-preview`). En væsentlig konsekvens skal kvitteres
eksplicit, ellers afvises ordren. Prisen beregnes server-side; klienten kan
ikke bestemme den.

## Kundens livscyklus

Kundetilstanden er `created → active → suspended → active` og
`created|active|suspended → winding-down → closed`
(`portal/src/lifecycle.mjs`). Hver overgang:

- kræver en autoriseret, verificeret person og en begrundelse,
- skriver et **hash-kædet revisionsspor**, som `verifyAuditTrail` kan
  efterprøve, og
- afvises hvis den er ulovlig i den aktuelle tilstand.

Afvikling kræver dokumenteret **eksport** og **sletning**, og `closed` kræver
en **anden person** end den, der startede afviklingen
(to-personers-kontrol af en irreversibel handling).

## Genoptagelig, idempotent provisionering

En ordre provisioneres i deterministiske trin
(`portal/src/provisioning.mjs`). Hvert trin har:

- en **idempotency-key** udledt af (kunde, pakke, version, modul), og
- en **deterministisk ressource-ID** `res://<tenant>/module/<pakke>-<modul>`.

Kører et tidligere trin igen — fordi et senere trin fejlede — genbruges den
allerede oprettede ressource i stedet for at oprette en ny. Trinene gemmes i
lageret, så genoptagelsen virker efter en genstart, og en unik indeksering i
SQLite forhindrer to rækker med samme idempotency-key. `duplicateResources`
efterprøver, at en ordre ikke har to succesfulde trin med samme ressource.

## Driftsstatus og forbrug

`portal/src/apps.mjs` udleder appoversigt, godkendelsesindbakke, driftsstatus
(`ok`/`provisioning`/`degraded`/`suspended`/`winding-down`) og forbrug fra
kundens ordrer og provisioneringstrin. Status er aldrig "grøn" på et uverificeret
grundlag: et fejlet trin gør status `degraded`, og et åbent trin gør den
`provisioning`.

## Dansk/engelsk og tilgængelighed

Alle synlige strenge ligger i `portal/src/i18n.mjs` og findes på både dansk og
engelsk (testet for nøgleparitet). UI'en sætter `<html lang>`, har en
"spring til indhold"-linje først i tabulatorrækkefølgen, `<label>` til hvert
felt, rigtige knapper/links og et `role="alert"`-område til fejl. Fejl er
lokaliserede og bærer en stabil kode.

## Ikke dækket her

- Et **rigtigt SSO/OIDC-login** og en rigtig IdP-session (`integration-portal-sso`).
- En **rigtig browser-/tastatur-/skærmlæsergennemgang** (`integration-portal-browser`).

De er NOT RUN i dette miljø; se `docs/status/portal.md` og baseline.
