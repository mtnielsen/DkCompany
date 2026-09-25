# Kundeadskillelse gennem kontrolplanet (DKC-006)

Reglen: **tenant udledes af den verificerede kontekst og følger alle data og
handlinger.** Et `tenantId` i URL, header eller body er en påstand, ikke en
autoritet. En påstand der ikke stemmer med den udledte tenant afvises.

## Fælles tenant-kontekst

| Fil | Ansvar |
| --- | --- |
| `identity/src/tenant.mjs` | `normalizeTenantId`, `resolveTenantContext`, `authorizeTenantAccess`, ressource-ID-kontrakt, `collectTenantClaims` og header-stripping |
| `identity/src/tenant-store.mjs` | Tenant-scoped datalager, cache, jobkø, filer, søgning, modelhistorik og hash-kædet audit-trail |
| `contracts/tenant-context.schema.json` | Kontrakten for en udledt kontekst: tenant, subjekt, kilde, scope og ressource-ID'er |
| `conformance/src/tenant.mjs` | Semantisk validator: kanonisk tenant, ressource-ID'er, claims og scope |

### Udledning

`resolveTenantContext({ principal, claimed, resourceIds, source })`:

1. Principalens `tenantId` er autoritativ.
2. Hver påstand i header/body/query og hver ressource-ID skal stemme med den;
   ellers kastes `tenant_mismatch` (HTTP 403).
3. Har principalen ingen tenant, kræves rollen `platform-admin` **og** en
   eksplicit scope (`platform-admin:<kunde>`, `platform-admin:*` eller et
   signeret `tenantScope`), der dækker præcis den ene kunde.

`collectTenantClaims({ headers, body, query })` indsamler påstandene fra
`x-tenant-id` m.fl. og `tenantId`/`tenant_id`/`customerId` m.fl.

### Ressource-ID

Kanonisk form: `res://<tenant>/<type>/<lokal-id>`. Tenant er en del af ID'et, så
identiske lokale id'er hos to kunder er forskellige ressourcer, og en fremmed
tenant ikke kan læses under en anden kundes namespace. `parseResourceId` afviser
tomme, kodede eller sti-lignende lokale id'er.

## Datalaget

| Adapter | Isolering |
| --- | --- |
| `createTenantStore` | Nøgle = `tenant + lokal id`; identiske id'er kolliderer ikke |
| `createTenantCache` | Hver tenant har sin egen namespace; TTL respekteres |
| `createTenantJobQueue` | Job bærer tenant fra kø til afslutning; lease og complete afviser fremmed tenant |
| `createTenantFileStore` | Filsti pr. tenant (hash), path traversal afvises |
| `createTenantSearchIndex` | Søgning filtrerer altid på tenant |
| `createTenantModelHistory` | Modelkald og forbrug er tenant-bundet |
| `createTenantAuditTrail` | Append-only hash-kæde pr. tenant; `filterEventsByTenant` kræver en tenant |

## API og UI-backend

- **Audit-service:** `tenantId` udledes af principalen; `locate`/`export`/`erase`
  kræver tenanten og rører ikke andre kunders poster; `GET /v1/audit/events`
  returnerer kun principalens egen kundes events. En tenant-swap i header/body
  afvises før PDP'en spørges.
- **Mattermost- og IAM-adapterne:** samme strenge resolver; en tenant-swap
  afvises med `tenant_mismatch`.
- **Godkendelser:** en anmoder kan ikke oprette for en fremmed kunde uden
  platformrolle + scope; en godkender fra en anden kunde afvises uden scope;
  `view`, `merge-check` og `GET /v1/approvals/<id>` kræver tenantadgang.
- **Runtime:** en opgave hvis `tenantId` ikke matcher agentens autoriserede
  tenant afvises, og alle audit-events bærer tenanten.
- **AI-gateway:** routes kan være tenant-afgrænsede, budget og modelhistorik er
  tenant-bundet, og en tenant-header der ikke matcher den signerede principal
  afvises.

## Operatørnoter

- Kør `make tenant-check` for kontraktvalidering og `make tenant-test` for
  isolations-testene (kontekst, datalager, API, UI-backend, gateway).
- Tildel krydskunde-adgang med `platform-admin:<kunde>` (eller `platform-admin:*`)
  i den signerede principal — aldrig som en header kunden selv sender.
- En tjeneste uden egen tenantbinding skal angive præcis én eksplicit tenant; to
  eller nul afvises.

## Kør

```bash
make tenant-check
make tenant-test
make validate
```

Verifikation skal udføres af en separat verifier; lokale tests er ikke
uafhængig verifikation.
