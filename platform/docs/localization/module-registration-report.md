# Modulregistrering for økonomi, HR og handel — rapport

> Genereret af `make localization-render` som en deterministisk kontrol. **Målt:** nej — en faktisk adapter og en menneskelig faglig afgørelse kræver en ekstern kilde.

- **Genereret:** 2026-03-01T00:00:00Z
- **Familier:** 5 (4 afventer jura, 1 registrerede, 0 danskklare)
- **Dækning:** 0 fuld, 0 delvis, 18 ikke undersøgt
- **Resolver:** 5 af 5 familier resolver uden fejl

## Familier

| Rækkefølge | Familie | Status | Danskklar | Kandidat | Kandidatgate | Afventende gates |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Økonomi/ERP (finance) | pending-legal-review | nej | Tryton | blocked | accounting:unreviewed, vat:unreviewed, payment:unreviewed |
| 2 | Fakturering (invoicing) | pending-legal-review | nej | Invoice Ninja | blocked | e-invoicing:unreviewed, vat:unreviewed, accounting:unreviewed, payment:unreviewed |
| 3 | HR og personaledata (hr) | pending-legal-review | nej | Frappe HR | blocked | payroll:unreviewed |
| 4 | Tid (time) | registered | nej | Kimai | blocked | — |
| 5 | Handel/webshop (commerce) | pending-legal-review | nej | Medusa | blocked | vat:unreviewed, payment:unreviewed |

## Dækningsmatrix

| Familie | Krav | Status | Blokerer |
| --- | --- | --- | --- |
| commerce | agreements | unsupported | nej |
| commerce | payment | unsupported | ja |
| commerce | vat | unsupported | ja |
| finance | accounting | unsupported | ja |
| finance | agreements | unsupported | nej |
| finance | authoritative-registers | unsupported | nej |
| finance | payment | unsupported | ja |
| finance | vat | unsupported | ja |
| hr | agreements | unsupported | nej |
| hr | authoritative-registers | unsupported | nej |
| hr | payroll | unsupported | ja |
| invoicing | accounting | unsupported | ja |
| invoicing | agreements | unsupported | nej |
| invoicing | e-invoicing | unsupported | ja |
| invoicing | payment | unsupported | ja |
| invoicing | vat | unsupported | ja |
| time | agreements | unsupported | nej |
| time | authoritative-registers | unsupported | nej |

## Kandidatrapporter

### Økonomi/ERP (finance)

| Produkt | Version | Score | Gate | Begrundelse |
| --- | --- | --- | --- | --- |
| Tryton | integration-candidate.tryton.example.json | 8 | blocked | OIDC-SSO, dokumenteret REST-API, dedikeret database pr. tenant, API-eksport, fri/åben kerne |
| ERPNext | integration-candidate.erpnext.example.json | 6 | blocked | OIDC-SSO, dokumenteret REST-API, API-eksport, fri/åben kerne |

### Fakturering (invoicing)

| Produkt | Version | Score | Gate | Begrundelse |
| --- | --- | --- | --- | --- |
| Invoice Ninja | integration-candidate.invoiceninja.example.json | 7 | blocked | OIDC-SSO, dokumenteret REST-API, dedikeret database pr. tenant, API-eksport |

### HR og personaledata (hr)

| Produkt | Version | Score | Gate | Begrundelse |
| --- | --- | --- | --- | --- |
| Frappe HR | integration-candidate.frappe-hr.example.json | 8 | blocked | OIDC-SSO, dokumenteret REST-API, dedikeret database pr. tenant, API-eksport, fri/åben kerne |

### Tid (time)

| Produkt | Version | Score | Gate | Begrundelse |
| --- | --- | --- | --- | --- |
| Kimai | integration-candidate.kimai.example.json | 8 | blocked | OIDC-SSO, dokumenteret REST-API, dedikeret database pr. tenant, API-eksport, fri/åben kerne |

### Handel/webshop (commerce)

| Produkt | Version | Score | Gate | Begrundelse |
| --- | --- | --- | --- | --- |
| Medusa | integration-candidate.medusa.example.json | 8 | blocked | OIDC-SSO, dokumenteret REST-API, dedikeret database pr. tenant, API-eksport, fri/åben kerne |

