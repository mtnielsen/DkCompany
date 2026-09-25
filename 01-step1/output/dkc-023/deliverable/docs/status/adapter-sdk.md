# Adapter-SDK og godkendelse

> Genereret af `make adapter-sdk-write`. Redigér ikke manuelt.

Hver adapter er godkendt på en eksakt upstream-version/edition. Gaten er hård:
manglende obligatorisk SSO eller en uafklaret licens blokerer kandidaten.

| Adapter | Upstream | Version | Edition | Gate | Blockers | Native admin |
| --- | --- | --- | --- | --- | --- | --- |
| mattermost-adapter | Mattermost | 10.0.0 | Enterprise | approved | — | beskyttet |
| keycloak-adapter | Keycloak | 26.0.0 | upstream | approved | — | beskyttet |

Kør `make adapter-sdk-check` for at efterprøve at profilerne er i trit.
