# Tværgående IAM og dataadgang for Communications, HR, BI og Reporting

DKC-060 giver de fire valgfrie funktionspakker én fælles model for ressource-,
række- og feltadgang, gæste- og tjenestekontoadgang, offboarding, rapportering
med revalideret adgang og en beskyttet datakildeconnector.

## Funktionsprofiler

Hver funktion har en profil i `feature-access/profiles/<id>.json`:

| Funktion | Formål | Moduler | Beskyttede felter |
|---|---|---|---|
| `communications` | `team-communication` | platform-core, identity-broker, object-store, communications | `attachment_content` (kræver `communications.attachment.read`), `guest_email` (redact) |
| `hr` | `hr-personnel-administration` | platform-core, identity-broker, primary-database, hr | `personnel_record`, `salary`, `health.condition` |
| `bi` | `business-intelligence` | platform-core, identity-broker, analytics-store, bi | `employee_name`/`employee_id` (redact); ingen lønregel |
| `reporting` | `regulated-reporting` | platform-core, object-store, bi, reporting | `report_output` (kræver `reporting.output.read`) |

Profilerne er **default-deny** på feltniveau. Et følsomt eller særligt felt
(`sensitive`, `special-category`) må kun tillades med en udtrykkelig
`requiresGrant`. Det betyder, at en BI-bruger ikke kan læse `salary`, og at et
almindeligt SSO-login ikke er bevis for downstream-autorisation.

`featureProfilesProblems` kræver desuden, at hver profil medtager
`platform-core`, dækker alle syv flader og har et formål, der ikke deles med en
anden funktion.

## Adgangsmotoren

`feature-access/src/access.mjs`:

- `decideAccess({ principal, profile, resource, fields, action, purpose, surface })`
  returnerer `allow`, `redact` eller `deny` med felter og begrundelser.
- `filterRows({ principal, profile, rows })` filtrerer tenantstrengt og derefter
  efter profilens rækkepolitik; intet match betyder, at rækken ikke returneres.
- `evaluateAcrossSurfaces` og `surfaceConsistencyProblems` evaluerer den samme
  beslutning på UI, API, connector, søgning, eksport, cache og AI-værktøj og
  rapporterer enhver afvigelse.

Reglerne: verificeret principal med tenantbinding, tenant udledt af principalen,
formålsoverensstemmelse, kun læsehandlinger på datasiderne og default-deny per
felt.

## Gæster og servicekonti

- En gæstebevilling er tidsbegrænset, peger på en eksplicit ressourceliste og
  et eksplicit felt sæt, arver ingen roller og er aldrig tenantbred.
- En servicekonto har præcis rollen `service-account`, er ikke-interaktiv, kan
  ikke impersonere et menneske og har et afgrænset sæt scopes uden `*`.

## Rapportering med revalideret adgang

`contracts/report-definition.schema.json` bærer kun afsenderens *subject* —
aldrig et creator-token. `authorizedReportRun` genopretter afsenderens og alle
modtageres rettigheder fra den autoritative kilde ved hver kørsel:

- `run` — afsender og alle modtagere er autoriserede nu;
- `reauthorize` — afsenderens grundlag er bortfaldet;
- `blocked` — mindst én modtager må ikke længere modtage rapporten.

`deliverReport` gentager revalideringen ved afsendelse og leverer intet, hvis
beslutningen ikke er `run`. `authorization.usedStoredCreatorToken` er altid
`false`.

## Offboarding

`feature-access/src/offboarding.mjs` lukker de fem rettighedsklasser
`sessions`, `api-tokens`, `shares`, `scheduled-workflows` og `ai-tool-grants`.
Planen er idempotent og fristbundet; et holdbart fillager (`createFileOffboardingStore`)
skriver atomisk, så tilstanden overlever genstart. En plan kan kun være
`complete`, når alle klasser er lukket inden fristen.

## Beskyttet connector

`createGuardedConnector` wrapper den eksisterende DKC-056-connector og afviser:

- rå SQL — der må kun bruges en godkendt, parameteriseret skabelon,
- administrator-/root-credentials,
- en principal, der ikke er en afgrænset tjenestekonto,
- en skabelon eller parameter, der ikke er erklæret for funktionen.

## Kommandoer

```bash
make feature-access-check   # profiler og kontrakteksempler (skema + semantik)
make feature-access-test    # enheds- og autorisationstests + konformans
make feature-access-demo    # kontrolleret forløb: BI vs. HR, rapport, offboarding, connector
```

## Kendte grænser

En rigtig rapportmodtager/-destination og en rigtig IdP/tokenudbyder findes ikke
i dette miljø og er registreret som NOT RUN i baseline-registeret
(`integration-reporting-delivery`, `integration-idp-offboarding`).
