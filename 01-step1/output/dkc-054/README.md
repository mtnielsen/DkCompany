# DKC-054 — Installer og fælles konfiguration med sikre standarder

Overlay til `00-core/` oven på stak-tip **DKC-046**. Implementerer en signeret
installer med preflight, installationsplan, resumable udførelse og diagnostik
uden hemmeligheder, samt én autoritativ, versioneret ønsket tilstand som den
deklarative fil, portalen (UI) og API'et deler — med sikre standarder, TTL-styret
debug, uforanderligt revisionsspor, retention pr. dataklasse og et eksplicit,
fail-closed host-scope.

- **Review-base:** `5f9fa73`
- **Checkout:** `83ad91a`
- **Forudsætninger:** DKC-006, DKC-014, DKC-019, DKC-025, DKC-053 (se
  `evidence/prerequisites.txt`)
- **Stak-kæde:** `dkc-046/apply.sh` → `dkc-045/apply.sh` → … → `dkc-001/apply.sh`
- **Miljø:** Node v22.22.1. Ingen Docker/kubectl/tofu/PostgreSQL/levende
  værtsmaskine eller hypervisor.

## Implementeret adfærd

### 1. Én autoritativ ønsket tilstand

`configuration/src/model.mjs` + `validate-api.mjs` er den ene model og den ene
validerings-API. Den deklarative fil (`configuration/desired-state.json`), UI'et
og API'et læser og skriver samme versionerede `PlatformConfiguration`-dokument
og får samme digest. `configuration/src/desired-state.mjs` planlægger ændringer
som et diff, opdager tavs drift (`driftPolicy: fail-closed`) og skriver en
ændring atomisk efter en navngiven menneskelig autorisation bundet til
dokumentets digest.

Indstillinger pr. installation/tenant/modul: `logLevel`, `debug` (TTL),
`retention` pr. dataklasse, `backups`, `modelRoutes` og `resourceLimits`. Sikre
standarder: debug slukket, backup tændt, ingen modelrute uden egress-godkendelse,
`personal`/`security` er WORM.

### 2. Debug-TTL og uforanderligt revisionsspor

`configuration/src/debug.mjs` slukker debug automatisk, når TTL udløber. De
obligatoriske revisionsevents registreres uanset logniveau; revisionssporet kan
ikke deaktiveres via konfigurationen (`assertAuditTrailActive`).

### 3. Retentionændringer med holds, WORM og ramme

`configuration/src/retention-change.mjs` viser de berørte dataklasser og
databærende artefakter og afviser ændringer der forkorter en WORM-beskyttet
klasse, bryder et legal hold eller ligger uden for den menneskeligt vedtagne
ramme.

### 4. Signeret installer med preflight og resumable trin

- `installer/src/preflight.mjs` — read-only, fail-closed: ikke-understøttet OS,
  diskformatering, databaseovertagelse, host-OS-ændring uden scope, fri root til
  agenter og manglende recoverykonsol afvises.
- `installer/src/plan.mjs` — deterministisk, HMAC-signeret plan med idempotente
  trin, preflight, resumable tilstand og diagnostik. Restriktionerne
  (`formatDisks`, `adoptExistingSchema`, `changeHostOs`) er altid `false`.
- `installer/src/state.mjs` + `run.mjs` — atomisk, holdbar tilstand; genoptagelse
  er idempotent, kræver samme plan-digest og et menneskeligt godkendt, scoped
  operationsticket pr. muterende trin.
- `installer/src/diagnostics.mjs` — redigerer hemmeligheder og blokerer
  (`SECRET_LEAK`) på signaturer i stedet for at skjule dem.

### 5. Portal (UI/API)

`portal/src/server.mjs` eksponerer `GET /portal/configuration`,
`GET /api/configuration`, `POST /api/configuration/validate` og
`POST /api/configuration/apply`. Alle kalder den samme validerings-API og den
samme autorisation; `config:change` kræver `platform-admin` med eksplicit scope
(default-deny). Portalen viser ønsket og faktisk tilstand og markerer drift.

### 6. GitOps

`gitops/manifests/dev/platform-configuration.json` bærer den ønskede tilstand og
dens digest som en ConfigMap med de obligatoriske labels.

## Ændrede filer

50 filer under `00-core/` (alle i `deliverable/`) plus denne `README.md` og
`apply.sh` i pakken:

| Område | Filer |
| --- | --- |
| Konfiguration | `configuration/src/{model,validate-api,desired-state,debug,retention-change,ui,cli}.mjs`, `configuration/{desired-state,host-scope,dev-keyring}.json`, `configuration/test/configuration.test.mjs` |
| Installer | `installer/src/{preflight,plan,state,run,diagnostics,cli}.mjs`, `installer/test/installer.test.mjs` |
| Kontrakter | `contracts/{platform-configuration,host-scope,installer-plan,retention-change-preview}.schema.json` + 4 eksempler |
| Konformans | `conformance/src/{configuration,configuration-check}.mjs`, `conformance/src/schemas.mjs`, `conformance/src/validate-schemas.mjs`, `conformance/test/configuration-conformance.test.mjs` |
| Portal | `portal/src/{server,authorization,constants}.mjs`, `portal/test/configuration.test.mjs` |
| GitOps | `gitops/manifests/dev/platform-configuration.json` |
| Register/Make | `Makefile`, `tools/baseline/registry.mjs` |
| Docs | `docs/adr/0059-…`, `docs/adr/README.md`, `docs/spec/{installer,configuration}.md`, `docs/spec/README.md`, `docs/runbooks/installation.md`, `docs/testing/test-matrix.md`, `docs/security/threat-model.md`, `docs/status/{implementation-matrix,portal}.md`, `release/matrix/{test-matrix,threats}.json` |

## Testkommandoer og -resultater

| Kommando | Resultat |
| --- | --- |
| `make configuration-check` | PASS — skema + semantik for konfiguration, host-scope, signeret plan og retention-preview; fil == UI-eksempel |
| `make configuration-test` | PASS — 12 (konfiguration) + 9 (installer) + 11 (konformans) tests |
| `make configuration-preview` | PASS — ønsket vs. faktisk tilstand og drift |
| `make installer-preflight` | PASS — alle preflight-checks grønne på det kanoniske scope |
| `make installer-plan` | PASS — plan bygget, signatur verificeret |
| `make portal-check` / `make portal-test` | PASS — 50 portaltests |
| `make release-check` (`matrixversion 1.28.0`) | PASS — 51 krav, 51 obligatoriske |
| `make validate` / `make lint` | PASS |
| `make test` | PASS — 352 konformanstests |
| `make baseline` | 148 pass, 1 fail, 0 error, 42 not run af 191 (den kendte `changelog-check`-fejl, se nedenfor) |

Den præcise kørsel ligger i `evidence/focused-tests.log` og
`evidence/baseline.log`.

## Acceptkriterier

| # | Kriterium | Status | Bevis |
| --- | --- | --- | --- |
| 1 | Ren installation fra dokumentationen uden manuelle database-/manifestredigeringer | PASS (statisk/deterministisk) | `docs/runbooks/installation.md`, `installer-preflight`, `installer-plan`, `configuration-test`; selve kørslen på en levende vært er `integration-installer-live` = NOT RUN |
| 2 | Afbrudt installation genoptages idempotent og giver tydelig status | PASS | `installer/test/installer.test.mjs` (afbrudt → genoptaget), `installer/src/state.mjs` |
| 3 | Hemmeligheder vises ikke i preview, CLI-argumenter, Git eller supportbundle | PASS | `installer/src/diagnostics.mjs` + `configuration-test` (redaktion + `SECRET_LEAK`) |
| 4 | Debug slukker efter TTL; revisionen kan ikke deaktiveres med logniveau | PASS | `configuration/src/debug.mjs`, `configuration-test` |
| 5 | Retentionændring viser berørte data og respekterer hold/WORM/ramme | PASS | `configuration/src/retention-change.mjs`, `configuration-test`, `retention-change-preview.example.json` |
| 6 | UI-/filændring giver samme effekt og ingen tavs drift | PASS | `configuration/src/validate-api.mjs`, `portal/test/configuration.test.mjs`, `configuration-check` (digest-lighed + driftdetektering) |

## Kendte fejl og begrænsninger

- **`changelog-check`:** kendt, præeksisterende FAIL (manglende DCO sign-off,
  også i `83ad91a`). Den er registreret ærligt og er ikke "rettet".
- **`integration-installer-live`:** NOT RUN. Der findes ingen levende
  værtsmaskine, hypervisor eller ekstern database i dette miljø. Preflight,
  plan, resumable udførelse og diagnostik er efterprøvet deterministisk.
- **Signeringsnøglen** i `configuration/dev-keyring.json` er en offentlig
  testfixture. Produktion kræver KMS/HSM (ekstern integration).
- Den faktiske "faktiske tilstand" i portalen er i denne statiske demo den
  samme som den ønskede; driften kan injiceres (og er testet) men ikke læses fra
  en levende klynge.

## Review

- Base: `5f9fa73457d22583b9948611d5cc3afffec4ae38`
- Checkout: `83ad91a963d8055f77c29fb4361455689df95acb`
- Base + diff: hele `deliverable/`-træet oven på stak-tippet DKC-046.
