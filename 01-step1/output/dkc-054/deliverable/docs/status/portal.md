# Portal og kundelivscyklus

Dette dokument er genereret fra `portal/service-packages/*.json` og den
fælles autorisationspolitik i `portal/src/authorization.mjs`. Kør
`make portal-write` for at genskabe det.

## Servicepakker

En servicepakke er versioneret og bestillingsbar. Prisen er den forventede
månedlige driftspris; hver væsentlig konsekvens skal kunden kvittere for, før
ordren kan oprettes.

| Pakke | Version | Kategori | Månedlig pris | Implementering | Væsentlige konsekvenser |
| --- | --- | --- | ---: | ---: | ---: |
| bi-suite | 1.0.0 | bi | 4200 DKK | 15000 DKK | 1 |
| communications-suite | 1.0.0 | communications | 3200 DKK | 9000 DKK | 1 |
| hr-suite | 1.0.0 | hr | 3600 DKK | 12000 DKK | 2 |
| starter | 1.0.0 | platform | 1500 DKK | 5000 DKK | 1 |

## Autorisationspolitik

UI og API kalder den samme `decidePortalAccess`. En platformrolle kræver
altid en eksplicit tenant-scope.

| Handling | Roller | Scope |
| --- | --- | --- |
| `customer:create` | platform-operator, platform-admin | any |
| `customer:view` | customer-admin, customer-viewer, platform-operator, platform-approver, platform-admin | own-or-platform |
| `customer:suspend` | customer-admin, platform-operator, platform-admin | own-or-platform |
| `customer:resume` | customer-admin, platform-operator, platform-admin | own-or-platform |
| `customer:wind-down` | customer-admin, platform-operator, platform-admin | own-or-platform |
| `customer:close` | platform-operator, platform-admin | platform |
| `order:create` | customer-admin, platform-operator, platform-admin | own-or-platform |
| `order:approve` | platform-approver, platform-admin | platform |
| `app:view` | customer-admin, customer-viewer, platform-operator, platform-approver, platform-admin | own-or-platform |
| `consumption:view` | customer-admin, customer-viewer, platform-operator, platform-approver, platform-admin | own-or-platform |
| `status:view` | customer-admin, customer-viewer, platform-operator, platform-approver, platform-admin | own-or-platform |
| `inbox:view` | customer-admin, platform-operator, platform-approver, platform-admin | own-or-platform |
| `config:view` | customer-admin, platform-operator, platform-approver, platform-admin | own-or-platform |
| `config:change` | platform-admin | platform |

## Livscyklus

Kundetilstande: `created → active → suspended → active` og
`created|active|suspended → winding-down → closed`. Afvikling kræver
dokumenteret eksport og sletning, og `closed` kræver en anden person end den,
der startede afviklingen. Alle overgange skriver et hash-kædet revisionsspor,
som `verifyAuditTrail` kan efterprøve.
