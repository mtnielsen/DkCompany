# DKC-006 — Håndhæv kundeadskillelse gennem hele kontrolplanet (leverance)

Implementering af **DKC-006** for `mtnielsen/DkCompany`. Bygger på DKC-001,
DKC-002, DKC-003, DKC-004 og DKC-005. `00-core/` er fortsat **ikke ændret**; alt
ligger under `01-step1/output/dkc-006/`.

## Hvad der er implementeret

1. **Fælles tenant-kontekst og ressource-ID-kontrakt.** `identity/src/tenant.mjs`
   er den ene kilde:
   - `normalizeTenantId` (kanonisk: trimmet, små bogstaver, begrænset alfabet)
   - `resolveTenantContext(...)` — principalens tenant er autoritativ; hver
     påstand i header/body/query/ressource-ID skal stemme, ellers afvises
     requesten med `tenant_mismatch`
   - `authorizeTenantAccess(...)` / `crossTenantScope(...)` — egen kunde er
     tilladt; en anden kunde kræver rollen `platform-admin` **og** en eksplicit
     scope (`platform-admin:<kunde>`, `platform-admin:*` eller et signeret
     `tenantScope`). Rollen alene giver intet.
   - ressource-ID `res://<tenant>/<type>/<lokal-id>` (`formatResourceId`,
     `parseResourceId`, `assertResourceTenant`), så identiske lokale id'er hos
     to kunder ikke kolliderer.
   `contracts/tenant-context.schema.json` + eksempel dokumenterer kontrakten, og
   `conformance/src/tenant.mjs` validerer den semantisk.

2. **Tenant-scoped datalag.** `identity/src/tenant-store.mjs` giver rigtige
   adaptere, hver med tenanten som første argument: dokumentlager, cache,
   jobkø (job bærer tenant fra kø til afslutning), fil-lager (hash-sti pr.
   tenant, path-traversal afvises), søgeindeks, modelhistorik og et
   hash-kædet audit-trail pr. tenant (`createTenantAuditTrail`,
   `filterEventsByTenant`).

3. **API, UI-backend og integrationer.** Tenant udledes af den verificerede
   principal i:
   - `modules/audit-service/.../server.mjs`: `body.tenantId`/`x-tenant-id` må
     ikke pege på en anden kunde (afvises før PDP'en spørges). Subjektregistret
     er tenant-bundet (`locate`/`export`/`erase` kræver tenant), og
     `GET /v1/audit/events` returnerer kun principalens egen kundes events.
   - `modules/mattermost-adapter/.../server.mjs` og
     `modules/keycloak-adapter/.../server.mjs`: samme strenge resolver.
   - `approvals/src/approval-service.mjs`: en anmoder kan ikke oprette for en
     fremmed kunde uden platformrolle + scope; en godkender fra en anden kunde
     afvises uden scope; `view`, `merge-check` og `GET /v1/approvals/<id>`
     kræver tenantadgang (UI-backenden).
   - `gateway/src/gateway.mjs`: routes kan være tenant-afgrænsede, budget og
     modelhistorik er tenant-bundet, og en tenant-header der ikke matcher den
     signerede principal afvises (når en authenticator er konfigureret).
   - `runtime/src/runtime.mjs`: en opgave hvis `tenantId` ikke matcher agentens
     autoriserede tenant afvises, og alle audit-events bærer tenanten.

4. **Kontrakt, checker og dokumentation.** `contracts/gateway-route.schema.json`
   får `tenantId`; `make tenant-check` og `make tenant-test` er nye mål og er
   registreret i `tools/baseline/registry.mjs` (komponenten `tenant-isolation`),
   så de optræder i baseline-matricen. ADR-0017 og
   `docs/spec/tenant-isolation.md` dokumenterer beslutningen.

## Ændrede/nye filer (overlay, relativt til `00-core/`)

```
identity/src/tenant.mjs                    (ny: kontekst, ressource-ID, scope)
identity/src/tenant-store.mjs              (ny: scoped db/cache/kø/filer/søgning/modelhistorik/audit)
identity/test/tenant.test.mjs              (ny)
identity/test/tenant-store.test.mjs        (ny)
contracts/tenant-context.schema.json       (ny kontrakt)
contracts/examples/tenant-context.example.json (nyt eksempel)
contracts/gateway-route.schema.json        (+ tenantId)
conformance/src/tenant.mjs                 (ny semantisk validator)
conformance/src/tenant-check.mjs           (ny CLI)
conformance/src/schemas.mjs                (+ tenantContext)
conformance/src/validate-schemas.mjs       (+ tenant-trin)
conformance/test/tenant-conformance.test.mjs (ny)
conformance/test/approval-conformance.test.mjs (+ UI-backend tenant-test)
approvals/src/approval-service.mjs         (tenant-scope på create/decide/view)
approvals/test/tenant-approval.test.mjs    (ny)
modules/audit-service/service/src/server.mjs  (streng tenant-resolver, tenant-scoped audit/subjekter)
modules/audit-service/service/src/store.mjs   (tenant-bundet subjektregister + filter)
modules/audit-service/service/src/evidence.mjs / cli.mjs (seed med tenantId)
modules/audit-service/service/test/server.test.mjs / store.test.mjs (+ tenant-tests)
modules/mattermost-adapter/service/src/server.mjs / evidence.mjs (+ tenant-resolver)
modules/mattermost-adapter/service/test/adapter.test.mjs (+ tenant-test)
modules/keycloak-adapter/service/src/server.mjs / evidence.mjs (+ tenant-resolver)
modules/keycloak-adapter/service/test/adapter.test.mjs (+ tenant-test)
gateway/src/gateway.mjs                    (tenant-bundet historik/budget + route-scope)
gateway/test/tenant-gateway.test.mjs       (ny)
runtime/src/runtime.mjs                    (afvis fremmed task-tenant, audit bærer tenant)
runtime/src/cli.mjs                        (+ --tenant)
runtime/test/tenant-runtime.test.mjs       (ny)
tools/baseline/registry.mjs                (+ tenant-test, tenant-check, tenant-isolation)
Makefile                                   (+ tenant-check, tenant-test, + i ci)
docs/adr/0017-tenant-kontekst-og-ressource-id.md (ny ADR)
docs/adr/README.md, docs/spec/README.md    (indeks)
docs/spec/tenant-isolation.md              (ny spec)
docs/status/implementation-matrix.md       (regenereret)
```

## Testkommandoer og resultater (checkout `83ad91a` + DKC-001..005, Node v22.22.1)

| Kommando | Resultat |
| --- | --- |
| `make tenant-check` | **1** tenant-konteksteksempel (skema + ressource-/scope-semantik) |
| `make tenant-test` | **94 pass / 0 fail** (identity 20, conformance 8, gateway 13, audit-service 26, mattermost 8, keycloak 8, approvals 11) |
| `make validate` | 23 skemaer, 22 eksempler, 5 arkitektur/identitet, 1 godkendelse, 1 tenant |
| `make identity-test` | **52 pass / 0 fail** |
| `make gateway-test` | **13 pass / 0 fail** |
| `make audit-service-test` | **26 pass / 0 fail** |
| `make adapter-test` | **8 pass / 0 fail** |
| `make iam-adapter-test` | **8 pass / 0 fail** |
| `make runtime-test` | **23 pass / 0 fail** |
| `make approval-test` | **11 pass / 0 fail** + **20 pass / 0 fail** (konformans) |
| `make agent-conformance-test` | **10 pass / 0 fail** |
| `make test` | **58 pass / 0 fail** |
| `make architecture-test` | **10 pass / 0 fail** |
| `make curriculum-test` | **5 pass / 0 fail** |
| `make baseline-test` | **8 pass / 0 fail** |
| `make baseline` | 53 checks: **43 pass, 1 fail, 0 error, 9 NOT RUN**; `tenant-test` og `tenant-check` **PASS** |

Evidens: `evidence/logs/*.log` og `evidence/baseline/` (JSON + logs). Den ene
baseline-fejl er fortsat `changelog-check` (manglende DCO sign-off, DKC-001-fundet).
Baselinekørslen ændrede de sporede `modules/*/conformance`-fixtures
(ikke-idempotente `*-evidence`-generatorer); de er nulstillet efter kørslen.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| To kunder med identiske lokale objekt-IDer kan ikke læse, ændre eller godkende hinandens data | **PASS** | `identity/test/tenant-store.test.mjs` (samme lokale id "42" i to tenants; cache/søgning/filer/audit), `modules/audit-service/.../server.test.mjs` (samme e-mail i acme/globex; erase rammer kun egen), `approvals/test/tenant-approval.test.mjs` (fremmed godkender afvises) |
| Udskiftning af tenant i URL, header eller body giver afvisning | **PASS** | `identity/test/tenant.test.mjs` (`tenant_mismatch` for body/URL), `modules/audit-service/.../server.test.mjs` og adapter-testene (body- og `x-tenant-id`-swap giver 403), `gateway/test/tenant-gateway.test.mjs` (header-swap giver 403) |
| Baggrundsjob og eksport bevarer tenant | **PASS** | `identity/test/tenant-store.test.mjs` (jobkø: lease/complete kun for egen tenant; artefakt-sti), `runtime/test/tenant-runtime.test.mjs` (opgave-tenant håndhæves; audit bærer tenanten), `modules/audit-service/.../server.test.mjs` (eksportens `artifactRef` indeholder `/acme/`) |
| Tests dækker både API, UI-backend og datalager | **PASS** | API: `server.test.mjs`, adapter-testene, `gateway/test/tenant-gateway.test.mjs`; UI-backend: `conformance/test/approval-conformance.test.mjs` (7b — `view` for egen kunde 200, fremmed 403, anonym 401); datalager: `identity/test/tenant-store.test.mjs` |

## Prerequisite-blokering: DKC-007 og DKC-055

- **DKC-007** ("Stram policy-, scope- og evidenskontrol") er **ikke**
  implementeret. DKC-006 afhænger ikke af den, men DKC-007 forudsætter til
  gengæld DKC-006. Næste naturlige skridt er DKC-007.
- **DKC-055** ("én rolle pr. agent") er fortsat **ikke** implementeret og
  afhænger selv af DKC-007. DKC-005's rolleadskillelses-scope er derfor stadig
  åbent. DKC-006's egne fire acceptkriterier kræver ikke DKC-055 og er dækket.

## Resterende begrænsninger

- **Ingen rigtig database.** Repoet har ingen ekstern database; "datalager" er
  de in-repo stores (dokument-, fil- og subjektlager). Tenantafgrænsningen er
  implementeret i disse adaptere og i audit-servicen, men row-level security i
  en rigtig DB er **ikke** bevist. DKC-008 (holdbar tilstand og migrationer) er
  ikke implementeret, så et delt/HA-lager med transaktionelle tenant-grænser
  udestår.
- **Søgning** er et tenant-scoped indeks i hukommelsen. En rigtig
  søgeplatform (fx Elastic/OpenSearch) med tenant-filter er en integration
  (NOT RUN).
- **Gatewayen** håndhæver tenant kun når en authenticator er konfigureret.
  Uden authenticator bevarer den bagudkompatibel adfærd (tenant = null), så
  eksisterende enhedstests ikke brækker; en deployeret gateway skal køre med
  authenticator.
- **Ingen rigtig IdP/SPIRE** i dette miljø; kontekstudledningen er testet med
  syntetiske signerede assertions og RS256-tokens.
- **Kontraktbrud i modulerne:** `subjects.locate/erase` kræver nu tenanten, og
  tjenester der tidligere læste `body.tenantId` skal omlægges. En
  versionsmigration/kompatibilitetslag er ikke leveret (hører til DKC-008).
- **DKC-001's `changelog-check`-fejl består** (4 commits mangler DCO sign-off).
- Overlay, ikke committed kode: `00-core/` er urørt.

## Til uafhængig gennemgang

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (5f9fa73).
- **Undersøgt checkout:** `83ad91a`.
- **Forudsætnings-overlays:** DKC-001, DKC-002, DKC-003, DKC-004, DKC-005
  (lægges via `apply.sh`, som kæder `dkc-005/apply.sh`).
- **Denne leverance:** `01-step1/output/dkc-006/` (39 filer i `deliverable/`,
  SHA256 i `OVERLAY-MANIFEST.txt`).
- Uafhængig verifikation, live-integrationer og menneskelig release-godkendelse
  er separate handlinger og er **ikke** udført her.
