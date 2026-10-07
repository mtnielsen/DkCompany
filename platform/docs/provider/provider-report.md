# Providerkontrakter og migrationskontrol — rapport

> Genereret af `make provider-render` som en deterministisk kontrol. **Målt:** nej — en rigtig backendudskiftning eller appmigration mod en levende upstream kræver ekstern infrastruktur.

- **Genereret:** 2026-03-01T00:00:00Z
- **Providerklasser:** 7, **capabilities:** 36 (27 obligatoriske, 22 sikkerhedskritiske)
- **Providere:** 19, **kompatibilitetsrækker:** 12, **fixtures:** 3

## Supportmatrix

| Skift | Klasse | Tilstand | Forhandling | Tilladt |
| --- | --- | --- | --- | --- |
| filesystem-local → object-store-s3 | storage | planned-migration | supported | ja |
| object-store-s3 → filesystem-local | storage | unsupported | unsupported | nej |
| sqlite-local → postgres-managed | database | planned-migration | supported | ja |
| sqlite-local → mysql-managed | database | unsupported | unsupported | nej |
| keycloak-iam → entra-iam | iam | planned-migration | supported | ja |
| keycloak-iam → legacy-ldap-iam | iam | unsupported | unsupported | nej |
| local-llm → external-llm | modelprovider | drop-in | supported | ja |
| local-llm → external-llm-basic | modelprovider | unsupported | unsupported | nej |
| sqlite-queue → nats-queue | queue | planned-migration | supported | ja |
| vault-local → s3-immutable | backup | planned-migration | supported | ja |
| nextcloud → dkc-apps | apps | planned-migration | supported | ja |
| nextcloud → bookstack | apps | unsupported | degraded | nej |

## Scenarier

| Scenarie | Principal | Bevisniveau | Resultat |
| --- | --- | --- | --- |
| capability-catalog-and-registry | platform:provider | real | PASS |
| support-matrix-classifies-switches | platform:provider | real | PASS |
| missing-capability-stops-switch | platform:provider | real | PASS |
| security-critical-not-downgraded | platform:security | real | PASS |
| verified-backend-replacement | oidc|ada.acme | fixture | PASS |
| verified-app-migration | oidc|ada.acme | fixture | PASS |
| iam-switch-preserves-identity-and-audit | oidc|ada.acme | fixture | PASS |
| unsupported-swap-rejected | oidc|ada.acme | real | PASS |
| tenant-isolation-default-deny | oidc|gus.globex | real | PASS |

## Funktionstab ved appmigration

- File/comments (partial): Nextcloud-kommentarer overføres uden @-mention-metadata; selve teksten bevares.
- Folder/comments (unsupported): Mapper i Nextcloud har ingen kommentarfunktion; feltet er tomt og vises som tabt funktionalitet før cutover.

