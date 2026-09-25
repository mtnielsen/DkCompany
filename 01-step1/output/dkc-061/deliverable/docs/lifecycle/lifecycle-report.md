# Produktlivscyklus — rapport

> Genereret af `make lifecycle-render` som en deterministisk kontrol. **Målt:** nej — en rigtig opdatering eller fjernelse på en levende installation kræver ekstern infrastruktur.

- **Genereret:** 2026-03-01T00:00:00Z
- **Releases:** 4 (1 stabile), **låste komponenter:** 11
- **Support-allowlist:** 6 kilder, **eksterne afhængigheder:** 3, **kerneflows:** 5

## Scenarier

| Scenarie | Principal | Bevisniveau | Resultat |
| --- | --- | --- | --- |
| release-catalog-signed-and-lifecycle-visible | platform:release | real | PASS |
| compatibility-lock-support-window-security-update | platform:release | real | PASS |
| update-impact-migration-approval-resume-rollback | oidc|ada.acme | fixture | PASS |
| shared-database-and-iam-removal-rejected | oidc|ada.acme | real | PASS |
| uninstall-preserves-data-and-recovery-metadata | oidc|ada.acme | real | PASS |
| destructive-delete-requires-evidence-and-two-person | oidc|ada.acme | real | PASS |
| support-bundle-redacted-no-secrets-no-hr-no-hidden-access | platform:support | real | PASS |
| offline-local-core-flows-preserved-external-visible | platform:operations | real | PASS |
| default-deny-and-tenant-isolation | oidc|gus.globex | real | PASS |

## Acceptkriterier

- ✔ Delt database/IAM afvises ved aktive moduler (`shared-database-and-iam-removal-rejected`)
- ✔ Almindelig uninstall bevarer data og recoverymetadata (`uninstall-preserves-data-and-recovery-metadata`)
- ✔ Udgået/tilbagekaldt pakke viser status og håndtering (`release-catalog-signed-and-lifecycle-visible`)
- ✔ Afbrudt upgrade genoptages eller gendannes (`update-impact-migration-approval-resume-rollback`)
- ✔ Supportbundle uden secrets/HR (`support-bundle-redacted-no-secrets-no-hr-no-hidden-access`)
- ✔ Internet-/LLM-udfald bevarer lokale kerneflows (`offline-local-core-flows-preserved-external-visible`)

