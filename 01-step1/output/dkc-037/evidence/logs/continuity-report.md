# Recovery-rapport (DKC-037)

Genereret: 2026-09-23T13:12:52.238Z. Freshness: 90 dage.

> En konfigurationspost er ikke et målt serviceniveau. `declared-only` og `not-measured` er ikke PASS.

| Modul | Kritikalitet | Forpligtelse | Netværkspartition | Målt | HA-badge | Produktionsklar |
| --- | --- | --- | --- | --- | --- | --- |
| `audit-service` | critical | accepted | fail-closed | declared-only | nej | nej |
| `dummy-ok` | medium | accepted | fail-closed | declared-only | nej | ja |
| `keycloak-adapter` | critical | proposed | fail-closed | not-measured | nej | nej |
| `mattermost-adapter` | medium | proposed | read-only | not-measured | nej | nej |

**Opsummering:** {"total":4,"accepted":2,"proposed":2,"measured":0,"declaredOnly":2,"notMeasured":2,"haBadge":0,"productionReady":1,"withGaps":4}

## audit-service — udestår

- kun en erklæret måling; ingen frisk probe
- HA-egnet, men der findes ingen frisk failover-måling

## dummy-ok — udestår

- kun en erklæret måling; ingen frisk probe

## keycloak-adapter — udestår

- målene er foreslåede og ikke vedtaget af et menneske
- ingen måling af tilgængelighed
- gendannelse er ikke testet

## mattermost-adapter — udestår

- målene er foreslåede og ikke vedtaget af et menneske
- ingen måling af tilgængelighed
- gendannelse er ikke testet

