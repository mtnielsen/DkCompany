# DKC-025 — Byg portal og kundens livscyklus

Kumulativ overlay oven på stak-tippet DKC-022. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-022/apply.sh` → `dkc-043/apply.sh` →
  `dkc-042/apply.sh` → … → `dkc-001/apply.sh`. DKC-025 afhænger formelt af
  **DKC-004** (autentiske, ændringsbundne godkendelser), **DKC-006**
  (kundeadskillelse), **DKC-013** (genoptagelig og idempotent eksekvering),
  **DKC-015** (reproducerbar GitOps) og **DKC-023** (fælles adapterværktøjer).
  Alle er verificeret i den anvendte stak: `approvals/`,
  `identity/src/tenant.mjs`, `jobs/` + `runtime/`, `gitops/` og `adapter-sdk/`.
- **Miljø:** Node v22.22.1. Ingen rigtig OIDC-udbyder/SSO, ingen browser eller
  skærmlæser, ingen levende IdP-session. De statisk fuldt gennemførlige dele er
  implementeret og efterprøvet; SSO- og browserintegration er NOT RUN.

## Implementeret adfærd

1. **Én autorisation for UI og API** (`portal/src/authorization.mjs`):
   `decidePortalAccess` er den eneste beslutningsfunktion. Default-deny; kun
   verificerede mennesker (demo/workload afvises); tenanten udledes af
   principalen; en platformrolle kræver **både** rollen og en eksplicit scope
   (`platform-operator:acme`, `platform-admin:*` eller signeret `tenantScope`).
   Den server-renderede UI og JSON-API'et kalder samme funktion.
2. **Versionerede servicepakker** (`portal/service-packages/*.json`,
   `contracts/service-package.schema.json`): pris med delpriser, konsekvenser
   (mindst én `material`), databehandling og supportprofil. `orderPreview`
   beregner driftsprisen server-side, og en væsentlig konsekvens skal kvitteres
   før bestilling.
3. **Kundelivscyklus** (`portal/src/lifecycle.mjs`): `created → active →
   suspended → active` og `→ winding-down → closed`. Hver overgang kræver en
   autoriseret person og en begrundelse og skriver et **hash-kædet
   revisionsspor** (`verifyAuditTrail`). Afvikling kræver dokumenteret eksport
   og sletning, og `closed` kræver en **anden person** (to-personers).
4. **Genoptagelig, idempotent provisionering** (`portal/src/provisioning.mjs`):
   deterministiske trin med en **idempotency-key** pr. (kunde, pakke, version,
   modul) og en deterministisk ressource-ID `res://<tenant>/module/…`. Et
   delvist fejlet forløb genoptages, og den allerede oprettede ressource
   genbruges i stedet for at blive oprettet igen.
5. **Appoversigt, roller, godkendelsesindbakke, driftsstatus og forbrug**
   (`portal/src/apps.mjs`): udledt af kundens ordrer og provisioneringstrin;
   status er `ok`/`provisioning`/`degraded`/`suspended`/`winding-down` og er
   aldrig grøn på et uverificeret grundlag.
6. **Tilgængelig, tosproget UI** (`portal/src/render.mjs`,
   `portal/src/i18n.mjs`): dansk/engelsk med nøgleparitet, `<html lang>`,
   spring-til-indhold, `role="alert"`-fejl, labels på alle felter og native
   tastaturbetjening.
7. **Holdbarhed** (`persistence/migrations/0013_portal_lifecycle.sql`,
   `persistence/src/adapters/portal.mjs`): fire tenant-bundne tabeller
   (`portal_customers`, `portal_orders`, `portal_provision_steps`,
   `portal_audit_events`) med unik idempotency-key pr. tenant. Livscyklussen
   kører uændret på SQLite og overlever en genstart.
8. **Konformans og checks** (`conformance/src/portal.mjs`,
   `conformance/src/validate-schemas.mjs` afsnit 34): skema plus beslutnings-
   semantik for pris, konsekvenser, revisionskæde, idempotency og dedup.

Den tredje formelle leverance — **administrative ændringer gennem godkendte
GitOps-flows** — er dækket ved, at livscyklussens ændringer er
godkendelsesbundne (DKC-004), alle ændringer sker i git (ADR-0005), og
portalen ikke har nogen kanal uden om `approvals` + `gitops`. Kilden er
`approvals/src/binding.mjs` og `gitops/src/{verify,reconcile}.mjs`; portalen
kalder dem ikke med en genvej.

`docs/status/portal.md` genereres fra servicepakkerne og
autorisationspolitikken med `make portal-write`, og `make portal-check` afviser
den, hvis den er ude af trit.

## Ændrede filer

60 filer (0 slettede): se `evidence/deliverable-files.txt`. De vigtigste:

- `portal/` — nyt modul: `package.json`, `service-packages/*.json` (4 pakker),
  `src/{constants,authorization,packages,lifecycle,provisioning,store,apps,i18n,render,server,docs,check,cli}.mjs`
  og `test/*.test.mjs` (7 testfiler + fixtures).
- `contracts/{service-package,tenant-lifecycle,customer-order}.schema.json` +
  3 eksempler.
- `conformance/src/portal.mjs`, `conformance/src/{schemas,validate-schemas}.mjs`,
  `conformance/test/portal-conformance.test.mjs`.
- `persistence/migrations/0013_portal_lifecycle.sql`,
  `persistence/src/adapters/portal.mjs`, `persistence/src/{db,index}.mjs`,
  `persistence/test/{portal,migrations,ha}.test.mjs`.
- `docs/spec/portal.md`, `docs/status/portal.md`,
  `docs/runbooks/{customer-onboarding,customer-offboarding}.md`,
  `docs/adr/0054-portal-og-kundelivscyklus.md` + opdateret `docs/adr/README.md`
  og `docs/spec/README.md`.
- `Makefile` (`portal-write/-check/-test/-preview/-demo` + `ci`),
  `tools/baseline/registry.mjs` (komponent `portal` + 6 checks),
  `release/matrix/{test-matrix,threats}.json` (REQ-PORTAL-001 + 2 trusler,
  matrixversion 1.23.0).
- `release/sbom/platform-sbom.cdx.json`, `release/artifacts.json`,
  `docs/status/{supply-chain,implementation-matrix}.md` (regenereret).
- `docs/testing/test-matrix.md`, `docs/security/threat-model.md` (regenereret
  med `make release-write`).

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (stak-tip DKC-022 + DKC-025). Alle nedenstående
er PASS i `evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS (60 kontraktskemaer, 3 portal-eksempler) | `evidence/validate.log` |
| `make lint` | PASS (551 JSON-filer) | `evidence/lint.log` |
| `make portal-check` | PASS (4 servicepakker) | `evidence/portal-check.log` |
| `make portal-test` | PASS (46 + 2 + 7 tests) | `evidence/portal-test.log` |
| `make portal-preview` | PASS (pris + konsekvenser) | `evidence/portal-preview.log` |
| `make portal-demo` | PASS (genoptaget provisionering, 0 dubletter) | `evidence/portal-demo.log` |
| `make release-check` | PASS (46 krav, matrixversion 1.23.0) | `evidence/release-check.log` |
| `make release-test` | PASS | `evidence/release-test.log` |
| `make persistence-check` | PASS (13 migrationer, 40 tenant-views) | `evidence/persistence-check.log` |
| `make persistence-test` | PASS | `evidence/persistence-test.log` |
| `make db-ha-check` | PASS | `evidence/db-ha-check.log` |
| `make db-ha-test` | PASS | `evidence/db-ha-test.log` |
| `make supply-chain-check` | PASS (SBOM med 40 førstepartskomponenter) | `evidence/supply-chain-check.log` |
| `make evidence-mode-check` | PASS | `evidence/evidence-mode-check.log` |
| `make test` | PASS (291 tests) | `evidence/test.log` |
| `make baseline` | 133 PASS, 1 FAIL, 39 NOT RUN af 173 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

### E2E på en frisk klon med kun pakkens `apply.sh`

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-025/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `portal-write`, `portal-check`, `portal-test`, `portal-preview`, `portal-demo`, `release-check`, `persistence-check`, `persistence-test`, `supply-chain-check`, `evidence-mode-check`, `test`) | PASS | `evidence/e2e-check.log` |
| træ-diff mod arbejdsklonen | byte-identisk (0 forskelle) | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **133 PASS, 1 FAIL, 0 error, 39 NOT RUN af 173 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult. De fire nye real-/contract-checks (`portal-check`, `portal-test`,
`portal-preview`, `portal-demo`) er PASS, og `integration-portal-sso` og
`integration-portal-browser` er NOT RUN med en præcis begrundelse. Baseline
muterer som vanligt sporede filer under `modules/*/conformance`; snapshottet
(47 filer) blev gendannet bagefter, og `diff -rq` viste ingen afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | En kunde kan oprettes, få modul og afvikles med revisionsspor | PASS | `portal/test/lifecycle.test.mjs`, `persistence/test/portal.test.mjs`, `make portal-demo`; `verifyAuditTrail` er tom |
| 2 | Delvist fejlet provisionering kan genoptages uden dobbeltressourcer | PASS | `portal/test/provisioning.test.mjs` (`reused ≥ 1`, `duplicateResources` tom), `make portal-demo`, `persistence/test/portal.test.mjs` |
| 3 | UI og API håndhæver samme rettigheder | PASS | `portal/test/server.test.mjs` (samme principal, samme afvisning/visning på begge flader), `portal/test/authorization.test.mjs` |
| 4 | Dansk/engelsk, tastaturbetjening og tydelige fejl er afprøvet | PASS (markup/mekanisme) | `portal/test/i18n-render.test.mjs` (nøgleparitet, `lang`, spring-til-indhold, labels, `role="alert"`); en faktisk browser-/skærmlæsergennemgang er NOT RUN (`integration-portal-browser`) |
| 5 | Kunde ser konsekvens og forventet driftspris før bestilling | PASS | `orderPreview` + `renderOrderPreview`, `portal/test/packages.test.mjs`, `make portal-preview`; kvittering håndhæves |
| — | En platformrolle kræver eksplicit scope; demo/workload afvises | PASS | `portal/test/authorization.test.mjs`, `portal/test/server.test.mjs` |
| — | To-personers godkendelse og afvikling | PASS | `portal/test/lifecycle.test.mjs` (`two_person_required`, `winddown_incomplete`) |
| — | Revisionskæden kan ikke ændres ubemærket | PASS | `portal/test/lifecycle.test.mjs`, `conformance/test/portal-conformance.test.mjs` |

## Leverancer (formelle)

1. **SSO, appoversigt, roller, godkendelsesindbakke, driftsstatus og forbrug** —
   implementeret; SSO/IdP-session er NOT RUN (se `portal/src/{authorization,apps,server,render}.mjs`).
2. **Versionsstyrede servicepakker med bestil, provisionér, suspendér,
   eksportér og afvikl** — implementeret (`portal/service-packages/`,
   `portal/src/{packages,lifecycle,provisioning}.mjs`).
3. **Administrative ændringer gennem godkendte GitOps-flows** — bundet til
   `approvals/` + `gitops/`; ingen kanal uden om git (ADR-0005, ADR-0015).

## Grænser og resterende arbejde

- Der findes ingen rigtig OIDC-udbyder eller IdP-session i dette miljø. Et
  faktisk SSO-login er **NOT RUN** (`integration-portal-sso`).
- Der findes ingen rigtig browser eller skærmlæser. En faktisk
  browser-/tastatur-/skærmlæsergennemgang er **NOT RUN**
  (`integration-portal-browser`). Markup, sprog, labels og tastaturrækkefølge er
  efterprøvet deterministisk.
- Provisioneringen bruger en deterministisk in-memory-executor i demo/test; det
  holdbare lager, idempotency-keys og dedup er efterprøvet. En rigtig
  provisioneringsadapter mod en levende platform er ikke i scope her.
- `changelog-check` forbliver den ene kendte FAIL (manglende DCO sign-off).

## Verifikation

Manifestet er selvkonsistent: alle hashes i `OVERLAY-MANIFEST.txt` er
verificeret med `sha256sum -c` (se `evidence/manifest-verify.log`, der ikke
indeholder sin egen linje). `evidence/e2e-tree-diff.txt` viser, at en frisk
klon med kun denne pakkes `apply.sh` er byte-identisk med arbejdsklonen.
