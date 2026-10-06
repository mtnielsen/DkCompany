# Migrations- og exitværktøjer — rapport

> Genereret af `make migration-render` som en deterministisk kontrol. **Målt:** nej — en rigtig kilde, en rigtig cutover og en menneskelig pilotgodkendelse kræver en ekstern installation.

- **Genereret:** 2026-03-01T00:00:00Z
- **Pilotapps:** 5, **kilder:** 6 på 2 tenant(s)
- **Poster i det deterministiske løb:** 3
- **Tabte facetter vist før cutover:** 9

## Valgt kildeformat pr. pilotapp

| Kilde | App | Format | Entiteter |
| --- | --- | --- | --- |
| files-acme | files | nextcloud-export-bundle@1 | 2 |
| projects-acme | projects | openproject-api-v3-json@1 | 3 |
| knowledge-acme | knowledge | bookstack-content-export@1 | 1 |
| support-acme | support | zammad-ticket-archive@1 | 1 |
| crm-acme | crm | espocrm-rest-json@1 | 2 |
| crm-globex | crm | espocrm-rest-json@1 | 1 |

## Dækningsmatrix

- Fuldt understøttet: 39
- Delvist: 7
- Ikke understøttet: 2

| App | Entitet | Facet | Status | Kilde | Forklaring |
| --- | --- | --- | --- | --- | --- |
| crm | Contact | acl | full | teams | — |
| crm | Contact | acl | full | teams | — |
| crm | Contact | attachments | full | attachments | — |
| crm | Contact | attachments | full | attachments | — |
| crm | Contact | comments | full | activities | — |
| crm | Contact | comments | full | activities | — |
| crm | Contact | links | partial | links | CRM-links til salgsforløb overføres som referencer; forretningslogikken i linket bevares ikke. |
| crm | Contact | links | partial | links | CRM-links til salgsforløb overføres som referencer; forretningslogikken i linket bevares ikke. |
| crm | Contact | ownership | full | assignedUser | — |
| crm | Contact | ownership | full | assignedUser | — |
| crm | Contact | timestamps | full | createdAt/updatedAt | — |
| crm | Contact | timestamps | full | createdAt/updatedAt | — |
| files | File | acl | full | acl | — |
| files | File | attachments | full | attachments | — |
| files | File | comments | partial | comments | Nextcloud-kommentarer overføres uden @-mention-metadata; selve teksten bevares. |
| files | File | links | full | links | — |
| files | File | ownership | full | owner | — |
| files | File | timestamps | full | createdAt/updatedAt | — |
| files | Folder | acl | full | acl | — |
| files | Folder | attachments | full | attachments | — |
| files | Folder | comments | unsupported | — | Mapper i Nextcloud har ingen kommentarfunktion; feltet er tomt og vises som tabt funktionalitet før cutover. |
| files | Folder | links | full | links | — |
| files | Folder | ownership | full | owner | — |
| files | Folder | timestamps | full | createdAt/updatedAt | — |
| knowledge | Page | acl | full | acl | — |
| knowledge | Page | attachments | full | attachments | — |
| knowledge | Page | comments | partial | comments | BookStack-kommentarer overføres uden redigeringshistorik for den enkelte kommentar. |
| knowledge | Page | links | full | links | — |
| knowledge | Page | ownership | full | ownedBy | — |
| knowledge | Page | timestamps | full | createdAt/updatedAt | — |
| projects | Project | acl | full | acl | — |
| projects | Project | attachments | partial | attachments | Vedhæftninger overføres som referencer til fil-appen; selve filen migreres separat og kan mangle i dry-run. |
| projects | Project | comments | full | comments | — |
| projects | Project | links | full | links | — |
| projects | Project | ownership | full | responsible | — |
| projects | Project | timestamps | full | createdAt/updatedAt | — |
| projects | WorkPackage | acl | full | acl | — |
| projects | WorkPackage | attachments | partial | attachments | Vedhæftninger overføres som referencer til fil-appen og er ikke indlejret i pakken. |
| projects | WorkPackage | comments | full | comments | — |
| projects | WorkPackage | links | full | links | — |
| projects | WorkPackage | ownership | full | assignee | — |
| projects | WorkPackage | timestamps | full | createdAt/updatedAt | — |
| support | Ticket | acl | partial | groupAccess | Zammad-gruppe-ACL overføres; artikel-niveau-hemmeligholdelse bevares ikke som separat regel. |
| support | Ticket | attachments | full | attachments | — |
| support | Ticket | comments | full | articles | — |
| support | Ticket | links | unsupported | — | Zammad-links mellem tickets overføres ikke; de vises som tabt funktionalitet før cutover. |
| support | Ticket | ownership | full | owner | — |
| support | Ticket | timestamps | full | createdAt/updatedAt | — |

## Scenarier

| Scenarie | Principal | Resultat |
| --- | --- | --- |
| chosen-source-format-per-pilot-app | platform:migration | PASS |
| coverage-matrix-shows-lost-functionality | platform:migration | PASS |
| dry-run-reconciles | platform:migration | PASS |
| resumable-idempotent-import | oidc|ada.acme | PASS |
| dedup-conflict-not-merged | platform:import | PASS |
| exit-export-readable-without-platform | oidc|ada.acme | PASS |
| pilot-approves-content-and-acl | oidc|ada.acme | PASS |
| cutover-requires-approval-and-rollback | oidc|ada.acme | PASS |
| tenant-isolation-default-deny | oidc|gus.globex | PASS |

## Cutover og rollback

- Cutover: cutover
- Rollback: rolled-back
- Tabt funktionalitet i planen: 2
  - File/comments: Nextcloud-kommentarer overføres uden @-mention-metadata; selve teksten bevares.
  - Folder/comments: Mapper i Nextcloud har ingen kommentarfunktion; feltet er tomt og vises som tabt funktionalitet før cutover.

## Exit-eksport

- Poster: 2
- Checksum: 46b068d8c791b9220630f63672300d02283d4048218fc850c694a9eb8ea92010
- Kan læses uden platformen: ja
- Filer: records.jsonl, records.csv, read-export.mjs, README.md

