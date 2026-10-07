# CRM med entydigt ejerskab af kundedata — rapport

> Genereret af `make crm-render` som en deterministisk kontrol. **Målt:** nej — en levende EspoCRM-installation og et rigtigt API-token kræver en ekstern kilde.

- **Genereret:** 2026-03-01T00:00:00Z
- **Poster:** 2 (1 virksomheder, 1 kontakter, 0 salgsforløb) på 1 tenant(s)
- **Aktiviteter:** 3
- **Valgt kandidat:** espocrm

## Kandidatcheck

| Produkt | Version | Score | Begrundelser | Gate |
| --- | --- | --- | --- | --- |
| EspoCRM | 8.4.2 | 8 | OIDC-SSO, dokumenteret REST-API, dedikeret database pr. tenant, API-eksport, fri/åben kerne | blocked |
| ERPNext | 15.42.0 | 6 | OIDC-SSO, dokumenteret REST-API, API-eksport, fri/åben kerne | blocked |

## Scenarier

| Scenarie | Principal | Resultat | Synlige | Skjulte |
| --- | --- | --- | --- | --- |
| candidate-check | platform:architecture | PASS | espocrm:8, erpnext:6 | — |
| import-update-export | oidc|ada.acme | PASS | crm:acme:Contact:9001 | — |
| retry-no-duplicates | platform:import | PASS | crm:acme:Contact:9002 | — |
| dedup-conflict-not-merged | platform:dedup | PASS | crm:acme:Contact:9003 | crm:acme:Contact:2999 |
| role-protection-and-isolation | oidc|ada.acme + oidc|gus.globex | PASS | crm:acme:Account:1001, crm:acme:Account:1002, crm:acme:Contact:2001, crm:acme:Contact:2002, crm:acme:Opportunity:3001, crm:acme:Activity:4001, crm:acme:Contact:9001, crm:acme:Contact:9002, crm:acme:Contact:9003 | crm:globex:Account:5001 |
| cross-cutting-deletion | oidc|ada.acme | PASS | — | crm:acme:Account:1001, crm:acme:Account:1002 |
| backup-and-recovery | platform:backup | PASS | — | — |

## Tværgående sletning

- Status: partial
- Flader: primary=full, activities=full, index=full, copies=full, backup=partial
- Resterende kopier: backup (2026-05-30T00:00:00.000Z)

## Backup og gendannelse

- Poster før/efter: 2 / 2
- Aktiviteter bevaret: ja

