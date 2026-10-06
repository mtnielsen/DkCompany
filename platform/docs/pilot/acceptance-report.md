# Installations- og releaseacceptance — rapport

> Genereret af `make acceptance-render` som en deterministisk kontrol. **Målt:** nej — en rigtig VPS/lokal/HA-installation og den menneskelige ejeraccept er særskilt NOT RUN.

- **Genereret:** 2026-03-01T00:00:00Z
- **Mål:** 3, **scenarier:** 13, **rollebrud:** 0

## Acceptmål og gates

| Mål | Profil | Beslutning | Aktive gates | Afventer ejeraccept |
| --- | --- | --- | --- | --- |
| enterprise-dedicated-host-immutable-selfhealing | enterprise-dedicated | pending-owner-acceptance | 7 | security, privacy, restore, role, host-management, immutable, self-healing |
| ha-cluster-core | ha-cluster | pending-owner-acceptance | 5 | security, privacy, restore, role, ha |
| small-vps-core | small-vps | pending-owner-acceptance | 4 | security, privacy, restore, role |

## Gate-status pr. mål

### enterprise-dedicated-host-immutable-selfhealing

| Gate | Anvendelig | Testbevis | Ejeraccept | Status |
| --- | --- | --- | --- | --- |
| security | ja | passed | pending | unapproved |
| privacy | ja | passed | pending | unapproved |
| restore | ja | passed | pending | unapproved |
| role | ja | passed | pending | unapproved |
| ha | nej | passed | not-applicable | not-applicable |
| host-management | ja | passed | pending | unapproved |
| immutable | ja | passed | pending | unapproved |
| self-healing | ja | passed | pending | unapproved |

### ha-cluster-core

| Gate | Anvendelig | Testbevis | Ejeraccept | Status |
| --- | --- | --- | --- | --- |
| security | ja | passed | pending | unapproved |
| privacy | ja | passed | pending | unapproved |
| restore | ja | passed | pending | unapproved |
| role | ja | passed | pending | unapproved |
| ha | ja | passed | pending | unapproved |
| host-management | nej | passed | not-applicable | not-applicable |
| immutable | nej | passed | not-applicable | not-applicable |
| self-healing | nej | passed | not-applicable | not-applicable |

### small-vps-core

| Gate | Anvendelig | Testbevis | Ejeraccept | Status |
| --- | --- | --- | --- | --- |
| security | ja | passed | pending | unapproved |
| privacy | ja | passed | pending | unapproved |
| restore | ja | passed | pending | unapproved |
| role | ja | passed | pending | unapproved |
| ha | nej | passed | not-applicable | not-applicable |
| host-management | nej | passed | not-applicable | not-applicable |
| immutable | nej | passed | not-applicable | not-applicable |
| self-healing | nej | passed | not-applicable | not-applicable |

## Brugerrejser

| Scenarie | Rejse | Profil | Platform | Resultat |
| --- | --- | --- | --- | --- |
| install-clean-small-vps-local | install | small-vps | linux-amd64-node22 | PASS |
| install-clean-small-vps-vps | install | small-vps | linux-arm64-node22 | PASS |
| install-interrupted-resumed | install | small-vps | linux-amd64-node22 | PASS |
| expand-add-hr | add-remove | small-vps | linux-amd64-node22 | PASS |
| configure-safe-defaults | configure | small-vps | linux-amd64-node22 | PASS |
| remove-app-preserve-data | add-remove | small-vps | linux-amd64-node22 | PASS |
| upgrade-release | upgrade | small-vps | linux-amd64-node22 | PASS |
| recover-interrupted-upgrade | recovery | small-vps | linux-amd64-node22 | PASS |
| provider-switch-database | provider-switch | small-vps | linux-amd64-node22 | PASS |
| escalation-approval | escalation | small-vps | linux-amd64-node22 | PASS |
| exit-export | exit | small-vps | linux-amd64-node22 | PASS |
| install-ha-cluster | install | ha-cluster | linux-amd64-node22 | PASS |
| install-enterprise-immutable-host-selfhealing | install | enterprise-dedicated | linux-amd64-node22 | PASS |

## Acceptkriterier

- ✔ Deterministiske brugerrejser består
- ✔ Alle aktive gates har gyldigt testbevis i fixturekørslen
- ✘ Alle aktive gates har registreret menneskelig ejeraccept
- ✔ Ingen agent kan udføre to roller (rotation/alias/subagent)

En `✘` på ejeraccept er forventet, indtil et navngivet menneske registrerer sin accept i `distribution/acceptance/owner-acceptance.json`.

