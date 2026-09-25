# DKC-023 — Fælles adapterværktøjer og godkendelsestest (leverance)

Implementering af **DKC-023** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-064. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt
ligger under `01-step1/output/dkc-023/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-064` → `dkc-018` → `dkc-015` → `dkc-014` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. Ingen rigtige upstream-instanser (Mattermost/Keycloak), ingen stagingklynge, ingen Docker/cosign/trivy.

## Forudsætninger og valg

DKC-023 afhænger formelt af DKC-002, DKC-006, DKC-007, DKC-018, DKC-019,
DKC-037, DKC-047 og DKC-053. Forudsætningerne er verificeret i kode, ikke i et
statusfelt:

- `identity/src/identity.mjs` + `identity/src/compat.mjs` (DKC-003) giver
  verificerbar identitet; `identity/src/tenant.mjs` (DKC-006) udleder tenant af
  den verificerede principal.
- `contracts/integration-candidate.schema.json` + `conformance/src/architecture.mjs`
  (DKC-002) beskriver en kandidat pr. eksakt version/edition med licens, SSO,
  API, isolation, eksport og backup.
- `conformance/src/evidence-mode.mjs` (DKC-018) gør evidens og den eksterne
  integration adskilt; `conformance/src/service-classes.mjs` (DKC-037),
  `data-protection/` (DKC-047) og `distribution/` (DKC-053) er aktive.
- Der fandtes **ingen** fælles SDK og **ingen** sporet godkendelse pr.
  version/edition. Mattermost- og Keycloak-adapterne kopierede auth, tenant, PDP,
  audit og health hver for sig.

Opgaven er delvist miljøblokeret: der findes ingen rigtig Mattermost/Keycloak at
køre mod. Valget var at implementere SDK'en, kandidatrapporten/releaseprofilen og
godkendelsesharnessen **rigtigt** og køre harnessen mod mock-upstream og den
rigtige PDP, mens rigtige upstream-instanser registreres ærligt som **NOT RUN**.

## Implementeret adfærd

1. **Ny SDK** `adapter-sdk/` med `createAdapterSdk()`, der ejer den gatede
   verbumskæde: auth → tenant → versionsforhandling → fail-closed PDP →
   godkendelses-/evidenskontrol → idempotens → handler → audit/CloudEvent.
   Desuden `health()`, `respond()`, `audit()` og `negotiate()`.
2. **Auth, tenant, PDP, audit, health, privacy** genbruges fra
   `identity/`, `identity/src/tenant.mjs` og en fail-closed PDP-klient. Et
   verbum uden verificerbar identitet giver 401; en fremmed tenantpåstand 403;
   utilgængelig governance 503; deny 403; manglende godkendelse/evidens 428.
3. **Holdbar idempotens**: migration `persistence/migrations/0009_adapter_idempotency.sql`
   + `persistence/src/adapters/adapter-idempotency.mjs`. Samme nøgle + samme
   indhold replayes; andet indhold giver 409; et fejlet forsøg kan genoptages.
   En in-memory-store findes kun til tests/offline harness.
4. **Versionsforhandling** `adapter-sdk/src/version.mjs`: `^`, `~`, `>=`, `<=`,
   `<`, `>`, `=`, `*`, `||`; `supported`/`degraded`/`unsupported` med begrundelse.
   En ikke-understøttet version/edition afvises før PDP.
5. **Kontrakt** `contracts/upstream-release-profile.schema.json`
   (`UpstreamReleaseProfile`) binder en `IntegrationCandidate` til adapterens
   verbumskontrakt: conformance pr. verbum, forhandlede serier, `nativeAdmin`
   og `approvalGate`.
6. **Semantiske validatorer** `conformance/src/adapter-sdk.mjs`: ærlig
   begrundelse pr. partial/unsupported, ingen overerklæring ift.
   modulmanifestet, eksakt version skal matche en serie, `nativeAdmin.exposed`
   må ikke være true, og gaten blokerer ved manglende SSO eller uafklaret licens.
7. **Kandidatrapport og releaseprofil** genereres deterministisk af
   `adapter-sdk/src/cli.mjs` fra `adapter-sdk/registry.json`, modulmanifesterne
   og kandidaterne i `contracts/examples/`, plus `docs/status/adapter-sdk.md`.
8. **Godkendelsesharness** `adapter-sdk/src/harness.mjs`: API-fejl, rate limits,
   versionsskift, backup, negativ adgang, idempotens og native admin-bypass.
   `createFaultPlan().wrap(client)` injicerer fejl uden at ændre adapteren.
9. **Mattermost-adapteren er lagt om til SDK'en** med uændret public API; alle
   oprindelige adaptertests er grønne, og harnessen kører mod den rigtige
   adapter og mock Mattermost. Keycloak-adapterens klient bevarer nu
   upstream-status/Retry-After til SDK-klassifikation.
10. **Release-krav** `REQ-ADAPTER-001` (matrix 1.5.0) kræver
    `adapter-sdk-check` og `adapter-sdk-test`.

## Ændrede filer (48 leverancefiler)

| Område | Filer |
| --- | --- |
| SDK | `adapter-sdk/` (package.json, registry.json, `src/` 7 filer, `test/` 5 filer) |
| Kontrakt | `contracts/upstream-release-profile.schema.json` + 2 kandidater + 2 releaseprofiler |
| Konformans | `conformance/src/adapter-sdk.mjs`, `conformance/src/{schemas,validate-schemas}.mjs`, `conformance/test/adapter-sdk-conformance.test.mjs` |
| Persistens | `persistence/migrations/0009_adapter_idempotency.sql`, `persistence/src/adapters/adapter-idempotency.mjs`, `persistence/src/{db,index}.mjs`, `persistence/test/migrations.test.mjs` |
| Adaptere | `modules/mattermost-adapter/service/src/{server,mattermost}.mjs` + `test/sdk-harness.test.mjs`, `modules/keycloak-adapter/service/src/keycloak.mjs` |
| Byg/CI | `Makefile`, `tools/baseline/registry.mjs`, `release/matrix/test-matrix.json` (1.5.0) |
| Dokumentation | `docs/spec/adapter-sdk.md`, `docs/runbooks/adapter-onboarding.md`, `docs/adr/0036-…`, `docs/status/{adapter-sdk,implementation-matrix,supply-chain}.md`, `docs/testing/test-matrix.md`, `docs/{spec,adr}/README.md`, `README.md` |
| SBOM | `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json` (regenereret pga. ny førstepartspakke) |

Den fulde liste findes i `evidence/logs/deliverable-files.txt`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | ✔ 55 skemaer, 58 eksempler, 2 releaseprofiler |
| `make lint` | ✔ 376 JSON-filer |
| `make test` | ✔ 163/163 |
| `make adapter-sdk-check` | ✔ 2 adaptere i trit, gate valideret |
| `make adapter-sdk-test` | ✔ 22 SDK-tests + 7 konformanstests + 1 harness-test |
| `make adapter-test` | ✔ 9/9 (8 oprindelige + harness) |
| `make iam-adapter-test` | ✔ 8/8 |
| `make persistence-check` | ✔ 9 migrationer, 25 tenant-views |
| `make release-check` / `release-test` | ✔ 28 krav; matrix 1.5.0 |
| `make supply-chain-check` | ✔ SBOM/provenance |
| `make conform-all` / `conform-negative` | ✔ PASS / forventet FAIL |
| `make -k ci` | 1225/1225 tests pass; kun target `changelog-check` fejler (kendt DCO-fund) |
| `make baseline` | 86 pass, **1 fail** (`changelog-check`), 0 error, 16 not-run af 103 |

## Acceptance criteria

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Én eksisterende adapter bruger SDK uden regression | **PASS** | Mattermost-adapteren bruger `createAdapterSdk`; `make adapter-test` 9/9 og `sdk-harness.test.mjs`. |
| Full/partial/unsupported måles pr. verbum | **PASS** | `verbMatrix`/`privacyMatrix` i releaseprofilen, validator + harness; `conformance/test/adapter-sdk-conformance.test.mjs`. |
| Native upstream-admin endpoints er beskyttet mod omgåelse | **PASS** | `nativeAdmin.exposed=false` håndhæves; harnessens `admin-bypass`-prøve får 404; beskyttelse kræver adapter+PDP+netværkspolitik. |
| Manglende obligatorisk SSO eller uafklaret licens stopper kandidatens godkendelse | **PASS** | `assessCandidateGate()` + `adapterReleaseProfileProblems()`; negative tests i `candidates.test.mjs` og konformanstesten. |

## Ærlige begrænsninger og NOT RUN

- **Ingen rigtige upstream-instanser.** `integration-mattermost` og
  `integration-keycloak` er **NOT RUN**; kun mock-adfærd er bevist. Rigtige
  scopes, rate limits og upstream-versioner er ikke bekræftet mod et levende
  system.
- **Ingen stagingklynge.** Native admin-beskyttelse er efterprøvet i adapteren
  (404) og i kontrakten; den faktiske default-deny-netværkspolitik er DKC-015's
  konfiguration, ikke en kørende klynge.
- **Harnessen er offline.** `createFaultPlan` injicerer fejl i klienten; den
  beviser adapterens fejlmapping, ikke at en rigtig upstream opfører sig sådan.
- **En grøn enhedstest er ikke produktionsstatus.** Uafhængig verifikation og
  menneskelig release-godkendelse er separate handlinger.
- **Kendt, eksisterende fejl:** `changelog-check` fejler, fordi baseline-commits
  mangler DCO sign-off (inkl. `83ad91a`). Den er hverken rettet eller skjult.

## Sådan efterprøves leverancen

```sh
rm -rf /tmp/dkc-023-verify
git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-023-verify
cd /tmp/dkc-023-verify && git checkout 83ad91a
/mnt/c/projects/DkCompany/01-step1/output/dkc-023/apply.sh /tmp/dkc-023-verify/00-core
cd /tmp/dkc-023-verify/00-core && make install
make validate && make lint && make test
make adapter-sdk-check && make adapter-sdk-test
make adapter-test && make iam-adapter-test
make persistence-check && make release-check && make release-test
make supply-chain-check && make conform-all && make conform-negative
cd /mnt/c/projects/DkCompany/01-step1/output/dkc-023
sha256sum -c OVERLAY-MANIFEST.txt
```

`OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
`apply.sh` med pakkerod-relative stier.
