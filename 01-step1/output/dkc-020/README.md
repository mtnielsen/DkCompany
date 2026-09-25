# DKC-020 — Gør indsigt og eksport til en rigtig tværgående proces (leverance)

Implementering af **DKC-020** for `mtnielsen/DkCompany`. Bygger på DKC-001 ..
DKC-024. `00-core/` i det faktiske repo er fortsat **ikke ændret**; alt ligger
under `01-step1/output/dkc-020/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-024` → `dkc-023` → `dkc-064` → `dkc-018` →
  `dkc-015` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. Ingen levende tredjepartsapps/upstream, ingen
  stagingklynge, intet Docker/cosign/trivy/tofu/kubectl.

## Forudsætninger og valg

DKC-020 afhænger formelt af DKC-013, DKC-019 og DKC-024. Forudsætningerne er
verificeret i kode, ikke i et statusfelt:

- `jobs/` + `persistence/src/adapters/job-queue.mjs` (DKC-013) giver holdbar
  jobtilstand med leases og idempotency; `persistence/src/migrations.mjs` giver
  versionsstyrede migrationer.
- `persistence/src/adapters/data-register.mjs` + `compliance/` (DKC-019) giver
  dataregister og retention; `data-protection/` (DKC-047) de beskyttede klasser.
- `adapter-sdk/` og begge adapteres privacy-endpoints (DKC-023/024) giver de
  **rigtige apps** en sag kan fan-out'e til.
- `conformance/src/dsar.mjs` var en tynd, statsløs fan-out: intet holdbart
  register, ingen autorisation, ingen timeout-klassifikation og intet
  eksportlink med udløb.

Der fandtes **ingen** holdbar DSAR-sag, **ingen** sagsbehandler-autorisation,
**ingen** fail-closed identitetsmatchning på tværs af tenant/ejer og **ingen**
sikret eksport. Opgaven er delvist miljøblokeret: der findes ingen levende
tredjepartsapps. Valget var at implementere hele processen **rigtigt** og
efterprøve den mod de to rigtige adaptere med mock-upstream, mens DSAR mod
levende apps registreres ærligt som **NOT RUN**.

## Implementeret adfærd

1. **Holdbar DSAR-sag** — migration `persistence/migrations/0010_dsar_cases.sql`
   (`dsar_cases`, `dsar_module_results`, `dsar_exports`) + tenant-bundet adapter
   `persistence/src/adapters/dsar.mjs`; `TENANT_TABLES` og migrerings-testen er
   opdateret. Sagen har sagsbehandler, deadline, idempotency-key og den seneste
   response; hvert moduls bidrag er den genoptagelige arbejdsenhed.
2. **Autorisation (default-deny)** — `privacy/src/authz.mjs`: kun et verificeret
   menneske i sagens tenant med `dpo`/`privacy-officer` (eller gruppen
   `dpo-approvers`); agenter, demo-identiteter, fremmed tenant og selvbetjening
   afvises.
3. **Sikker identitetsmatchning** — `privacy/src/identity.mjs`: normalisering,
   fail-closed på fremmed tenant og anden ejer; udeladte poster tælles.
4. **Genoptagelig fan-out med ærlig status** — `privacy/src/case-service.mjs`
   kalder kun ikke-terminale moduler og klassificerer timeout → `failed` og
   uopnåelig app → `unknown`; `conformance/src/dsar.mjs` er udvidet med
   `found`/`unknown`, timeout og normalisering af adapterkuverten.
5. **Sikret eksport** — `privacy/src/export.mjs`: bundet til tenant, modtager,
   udløb og et artefakt med SHA-256; payloaden ligger i et artefakt
   (`privacy/src/artifact-store.mjs`), ikke i registeret; `auditRef` binder til
   revisionen. Kontrakt: `contracts/privacy-export.schema.json` + validator
   `conformance/src/privacy.mjs`.
6. **Registrering** — Makefile-mål `privacy-check/-test/-run`, baseline-checks
   (`privacy-check` contract, `privacy-test` real, `integration-privacy-live`
   external) og en `privacy`-komponent. Testmatrixen er hævet til 1.7.0 med
   `REQ-PRIVACY-002`.
7. **Dokumentation** — `docs/spec/privacy-process.md`,
   `docs/runbooks/dsar-handling.md`, ADR-0038, opdateret `privacy-verbs.md` og
   indekser.
8. **SBOM** — ny førsteparts `privacy/package.json`, så SBOM/artefaktmanifest/
   `docs/status/supply-chain.md` er regenereret med `make supply-chain-sbom`.

## Ændrede filer

Se `evidence/logs/deliverable-files.txt` for den fulde, maskinelt udledte liste
(45 filer). Hovedpunkter:

- Nye: hele `privacy/` (8 kilder + 5 tests), `persistence/migrations/0010_dsar_cases.sql`,
  `persistence/src/adapters/dsar.mjs`, `contracts/privacy-export.schema.json` +
  eksempel, `conformance/src/privacy.mjs` + test, `docs/spec/privacy-process.md`,
  `docs/runbooks/dsar-handling.md`, `docs/adr/0038-…`.
- Ændrede: `conformance/src/dsar.mjs`, `contracts/privacy-response.schema.json`
  (+ eksempel, `found`/`unknown`), `persistence/src/db.mjs`/`index.mjs` +
  migrerings-test, begge adapteres `server.mjs` (accepterer `subject.identifiers`),
  `Makefile`, `tools/baseline/registry.mjs`, `release/matrix/test-matrix.json`
  (1.7.0), `docs/status/implementation-matrix.md`, `docs/testing/test-matrix.md`,
  `README.md`, `docs/spec/README.md`, `docs/adr/README.md`, SBOM/artefakter.

Deliverable-sættet er beregnet ved at diffe arbejdstræet mod et referenceklon med
kun `dkc-024/apply.sh` lagt (walk af alle filer, `node_modules` undtaget); nye
mapper (`privacy/`) er gennemgået rekursivt. Kørsels-muterede fixtures
(`modules/*/conformance/**`, 30 filer) er gendannet fra referenceklonen.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS |
| `make lint` | PASS |
| `make privacy-check` | PASS |
| `make privacy-test` | PASS (18 privacy-tests + 3 conformance-tests) |
| `make privacy-run` | PASS (offline sag → status → eksport) |
| `make persistence-check` / `persistence-test` | PASS (incl. v10-migrering) |
| `make release-check` / `release-test` | PASS (30 krav, matrix 1.7.0) |
| `make supply-chain-check` / `supply-chain-test` | PASS (regenereret SBOM) |
| `make adapter-test` / `iam-adapter-test` / `test` | PASS (ingen regression) |
| `make dsar-demo` | PASS |
| `make baseline` | 90 pass, 1 fail (kendt `changelog-check`), 18 not run |

Logfiler ligger i `evidence/logs/`; den fulde baseline i `evidence/baseline/`.

## Acceptkriterier

| Kriterium | Status | Evidens |
| --- | --- | --- |
| Syntetisk person på tværs af to rigtige apps findes og eksporteres | **PASS (adaptere + mock-upstream) / NOT RUN (levende apps)** | `privacy/test/case-service.test.mjs` starter Mattermost- og Keycloak-adapterne og eksporterer ≥5 poster; live er `integration-privacy-live` NOT RUN. |
| Samme e-mailtekst i en anden tenant udleveres ikke | **PASS** | `case-service.test.mjs` (fremmed tenant → `failed`/`unknown`, 0 full), `identity.test.mjs` (fremmed tenant matcher aldrig). |
| Timeout og nedetid giver partial/failed, aldrig fuld succes | **PASS** | `case-service.test.mjs` (hangende server → `failed`, lukket endpoint → `unknown`) og `conformance/test/privacy-conformance.test.mjs`. |
| Forkert sagsbehandler og udløbet eksportlink afvises | **PASS** | `authz.test.mjs` (default-deny), `export.test.mjs` (udløb, forkert modtager, fremmed tenant, tilbagekaldt, manipuleret digest). |

## Resterende begrænsninger

- DSAR mod **levende** tredjepartsapps og rigtige kundedata er **NOT RUN**;
  ingen sådanne instanser findes her.
- Den offline artefaktbutik er i hukommelsen; en deployment bruger en krypteret
  objektbutik med samme `put`/`get`-interface.
- En gendannelse kan genindføre slettede personoplysninger; runbooken kræver
  rekonsumering af slettefrister og DSAR-status efter restore.
- Den forudgående `changelog-check`-FAIL (manglende DCO sign-off) er dokumenteret
  og ikke ændret i denne opgave.

## Verifikation af pakken

- `OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
  `apply.sh` med SHA256 og pakkerod-relative stier; verificeret med
  `sha256sum -c`.
- `apply.sh` er kørt end-to-end på et friskt `83ad91a`-klon; træet er
  byte-identisk med arbejdsklonen, og de fokuserede checks er grønne.
