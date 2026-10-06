<!-- GENERERET af data-services/src/cli.mjs fra data-services/. Redigér registry-data, ikke denne fil. -->

# Datatjenester: indbyggede og eksterne kilder

Platformen driver ikke sin egen databaseengine. Den beskriver en administreret profil og en BYO-profil mod understøttede motorer, og den fører et eksplicit ejerskab for patching, backup, restore, nøgler og omkostninger.

## Databaseprofiler

| Profil | Type | Motor | Understøttede versioner | Kryptering i hvile | Tenant-isolation | Backup | Verificeret restore |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `byo-postgres` | byo | postgresql | >=15.0.0 <17.0.0 | påkrævet | schema-per-tenant | til | ja |
| `managed-postgres` | managed | postgresql | >=15.0.0 <16.0.0, >=16.0.0 <17.0.0 | påkrævet | database-per-tenant | til | ja |

## Ansvarsmatrix

| Profil | Patching | Backup | Restore | Nøgler | Omkostninger | Overvågning | Migration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `byo-postgres` | customer — Henrik Hansen (Customer DBA) | customer — Henrik Hansen (Customer DBA) | customer — Henrik Hansen (Customer DBA) | customer — Henrik Hansen (Customer DBA) | customer — Henrik Hansen (Customer DBA) | shared — Henrik Hansen (Customer DBA) | platform — David Dahl (Service Owner) |
| `managed-postgres` | platform — Anna Andersen (Platform Owner) | platform — Cecilia Christensen (Continuity Owner) | platform — Cecilia Christensen (Continuity Owner) | platform — Cecilia Christensen (Security Owner) | platform — Anna Andersen (Platform Owner) | platform — Carl Iversen (Operations Owner) | platform — David Dahl (Service Owner) |

## Datakilder (connectorer)

| Kilde | Type | Dataejer | Klassifikation | Scope | Read-only | Auto-migrate | Auto-backup | Secret-reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `analytics-source` | analytics | Cecilia Christensen | pseudonymised | reporting → reporting.metrics_daily, reporting.dim_department | ja | nej | nej | `vault:secret/data/analytics/readonly#password` |
| `hr-source` | hr | Ingrid Iversen | personal | hr → hr.employees, hr.departments, hr.employee_departments | ja | nej | nej | `vault:secret/data/hr/readonly#password` |

En ekstern kilde er ikke platformens egen database: `treatAsOwnDatabase`, `autoMigrate` og `autoBackup` er kontraktuelt låst til `false`.

## Applikationsbindinger

| Binding | Applikation | Databaseprofil | Datakilder | Tenant-scope | Adskilt identitet |
| --- | --- | --- | --- | --- | --- |
| `dummy-ok-binding` | dummy-ok | `managed-postgres` | hr-source | per-tenant | ja |
