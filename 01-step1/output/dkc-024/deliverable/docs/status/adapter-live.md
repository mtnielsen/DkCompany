# Live-integration og opgradering

> Genereret af `make adapter-live-write`. Redigér ikke manuelt.

Hver adapter er pinnet til en eksakt upstream-version/edition og kræver en
miljøbinding for at kunne bevises live. Uden bindingen er hver prøve **NOT RUN**.

| Adapter | Pinnet version | Edition | Binding (adapter) | Decideret rollback |
| --- | --- | --- | --- | --- |
| mattermost-adapter | 10.0.0 | Enterprise | `DKC_LIVE_MATTERMOST_ADAPTER_URL` | restore-from-backup (planned) |
| keycloak-adapter | 26.0.0 | upstream | `DKC_LIVE_KEYCLOAK_ADAPTER_URL` | restore-from-backup (planned) |

De dokumenterede scope-, rate-limit- og restdataforhold pr. adapter står i
`adapter-sdk/live-targets.json` og i `docs/spec/adapter-live-integration.md`.
Kør `make adapter-live-run` for at prøve mod rigtige instanser.
