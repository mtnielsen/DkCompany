# Support og sagsbehandling — rapport

> Genereret af `make helpdesk-render` som en deterministisk kontrol. **Målt:** nej — en faktisk Zammad-installation og et rigtigt token kræver en ekstern kilde.

- **Genereret:** 2026-03-01T00:00:00Z
- **Sager:** 4 på 2 tenant(s), 6 beskeder, 2 vedhæftninger (1 i karantæne)
- **Butik genindlæst fra disk:** ja
- **Historikdigest:** `291ed26b1744c6db22bc0f622f11f272c232aaa7d8f354d0495d3a73a213e95a`

## Scenarier

| Scenarie | Principal | Resultat | Synlige | Skjulte |
| --- | --- | --- | --- | --- |
| intake-mirrored | oidc|ada.acme | PASS | zammad-acme:1001, zammad-acme:1002, zammad-acme:1003, zammad-globex:1001 | — |
| intake-to-closure | oidc|sara.support | PASS | zammad-acme:1001 | — |
| approval-required | oidc|bea.billing | PASS | zammad-acme:1002 | — |
| attachment-injection-neutralized | oidc|ada.acme | PASS | zammad-acme:1003 | — |
| external-customer-isolation | oidc|ada.acme + oidc|gus.globex | PASS | zammad-acme:1001, zammad-globex:1001 | zammad-acme:1002, zammad-acme:1003 |
| retention-and-recovery | platform:retention | PASS | — | zammad-acme:1001, zammad-acme:1003 |

## Backup og gendannelse

- Sager før/efter: 4 / 4
- Historik bevaret: ja

## Retention

- Sletterapport: full
- Flader: mail=full, bilag=full, indeks=full
- Retention: 0 mail / 0 bilag / 0 indeks ældre end grænsen

