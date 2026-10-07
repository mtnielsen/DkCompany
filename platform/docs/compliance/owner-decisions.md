# Ejerbeslutninger for dataregisteret

> Syntetiske referencebeslutninger. De erstatter ikke en rigtig DPO- eller
> ledelsesbeslutning; de findes, for at registeret og dets blockere kan
> efterprøves i et reference-repo. Behandlingsgrundlaget er et ejerbesluttet
> felt i `compliance/data-register.json`; koden udleder det aldrig.

| Post | Beslutning | Grundlag | Besluttet af | Dato |
| --- | --- | --- | --- | --- |
| `audit-service` | `decision://platform/dkc-019/audit-service` | legitimate-interests | Anna Andersen (Platform Owner) | 2025-09-01 |
| `dummy-ok` | `decision://platform/dkc-019/dummy-ok` | legitimate-interests | Anna Andersen (Platform Owner) | 2025-09-01 |
| `keycloak-adapter` | `decision://platform/dkc-019/keycloak-adapter` | legitimate-interests | Anna Andersen (Platform Owner) | 2025-09-01 |
| `mattermost-adapter` | `decision://platform/dkc-019/mattermost-adapter` | legitimate-interests | Anna Andersen (Platform Owner) | 2025-09-01 |
| `privacy-operator` | `decision://platform/dkc-019/privacy-operator` | legitimate-interests | Anna Andersen (Platform Owner) | 2025-09-01 |
| `dummy-ok-reviewer` | `decision://platform/dkc-019/dummy-ok-reviewer` | legitimate-interests | Bo Bertelsen (Operations Lead) | 2025-09-01 |

En ændring af en beslutning eller en slettefrist kræver en ny registerversion og
en ny godkendelse. En post uden en besluttet grund må ikke stå som godkendt; se
`entryBlockers` i `conformance/src/data-register.mjs`.
