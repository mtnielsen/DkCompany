# IAM-adapter: Keycloak / Authentik

**Kode:** [`modules/keycloak-adapter`](../../modules/keycloak-adapter)
**Backlog:** 4.2 (første adapter i rækkefølgen)

> Wrapper upstream uændret. Privacy-verberne er kernen; `subject.erase` er ærligt `partial`.

## Hvad adapteren gør

IAM-adapteren oversætter platformens privacy-verber til Keycloaks Admin REST API. Den ændrer intet ved Keycloak: brugere, sessioner og hændelser bliver hvor de er, og adapteren lægger kun governance foran.

| Verbum | Niveau | Begrundelse |
| --- | --- | --- |
| `health` | `full` | Realm-info spejler upstreams tilstand uden admin-rettigheder |
| `subject.locate` | `full` | Find bruger, sessioner og hændelser via e-mail |
| `subject.export` | `full` | Eksportér brugerrepræsentation, sessioner og hændelser |
| `subject.erase` | `partial` | Brugeren slettes, men event-store, backups og cachede tokens er ikke nødvendigvis væk |
| `subject.legal_hold` | `partial` | Kontoen kan deaktiveres, men en administrator kan stadig slette den |
| `drain`, `upgrade.dry-run`, `slo` | `partial` | Adapteren kan måle og rapportere sit eget, men ikke styre upstreams drift |
| `backup`, `restore`, `verify-restore`, `upgrade`, `migrate`, `rollback` | `unsupported` | Ligger på database- og containerlaget uden for Admin API'et |

`subject.erase` er det interessante tilfælde. En naiv adapter ville kalde delete og erklære `full`. Det ville være en løgn: sletningen efterlader spor i event-loggen og kopier i backups. Adapteren erkender grænsen i selve API-svaret og i manifestet, og conformance-suiten accepterer den som `partial` — ikke som fail.

## Sådan køres det

```bash
make iam-adapter-test       # 7 tests mod mock Keycloak
make iam-adapter-evidence   # fremkald konformansbevis og partial-erkendelse
make conform MODULE=keycloak-adapter
```

Adapteren følger mønsteret fra referenceadapteren (Mattermost): tynd upstream-klient, lokal SPIFFE-shim, fail-closed PDP-klient og ét CloudEvent pr. handling. Det er hele pointen: når kontrakten og suiten findes, er en ny adapter et lille, afgrænset arbejde.
