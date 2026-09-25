# DKC-048 — Håndhæv immutable data uden for agentens kontrol

Kumulativ overlay oven på DKC-001..DKC-041. Lægges med `./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73`
- **Undersøgt checkout:** `83ad91a`
- **Forudsætninger:** DKC-010, DKC-041 og DKC-047 er verificeret til stede i den
  anvendte stak (`credentials/`, `storage/storage-plan.json`,
  `data-protection/records/register.json` + `contracts/protected-data.schema.json`).
  Overlayen kæder `dkc-041/apply.sh` (→ `dkc-039/apply.sh` → … → DKC-001).
- **Node:** v22.22.1

## Implementeret adfærd

En kompromitteret agent eller appkonto må ikke kunne ødelægge beskyttede data
eller deres nøgler. DKC-048 gør DKC-047's adgangs-/transitionskontrol fysisk.

1. **Politik og kontrakt** (`data-protection/enforcement/immutable-policy.json`,
   `contracts/immutable-enforcement.schema.json`): et verificeret S3-kompatibelt
   storage-produkt med object-lock i GOVERNANCE og COMPLIANCE, en rollematrix,
   agentnægtelser, beskyttede ressourcer og to-personers kontrol.
2. **Object-lock i lageret** (`storage/src/object-store.mjs`): `lockVersion`
   forlænger kun en lås og kan ikke forkorte/nedgradere; `deleteVersion` afviser
   en aktiv COMPLIANCE-lås og en GOVERNANCE-lås uden eksplicit bypass;
   `authoritative` returnerer den låste version, så en ny version ikke skjuler
   den; `getAuthoritative` læser den.
3. **Rolle-håndhævelse** (`data-protection/src/enforcement.mjs`): default-deny;
   AI (`agent`) og app-konti kan ikke skrive, slette, forkorte retention, skifte
   pointer, slette nøgle, ændre lifecycle/serviceaccount/trust-config eller
   bruge en af syv indirekte adminveje; `audit-ingest` er append-only; en ukendt
   principal nægtes.
4. **Beskyttet nøglebutik** (`data-protection/src/key-protection.mjs`):
   nøglesletning kræver `security-admin` + en separat godkender og afvises for
   nøgler der stadig understøtter en retention-locked post; rotation bevarer
   gamle versioner.
5. **To-personers kontrol** for beskyttelsespolitik, recovery-adgang og
   governance-bypass; anmoderen må ikke godkende selv, og COMPLIANCE kan ikke
   omgås af nogen godkendelse.
6. **Lagervarieret verifikation** (`data-protection/src/storage-semantics.mjs`):
   negative håndhævelsestests (COMPLIANCE afvises, GOVERNANCE kræver flag,
   retention forkortes ikke, ny version skjuler ikke den låste).
7. **Backup/restore** (`data-protection/src/protected-backup.mjs`): eksportér og
   gendan versioner, låse, autoritativ pointer og politikken; en tabt lås afvises.
8. **Renderede manifester** (`gitops/manifests/data-protection/`, 7 filer):
   object-lock-konfiguration, Kyverno-agentnægtelse, append-only audit-ingest
   RBAC, KMS-nøglepolitik, to-personers politik og default-deny-netværk;
   `immutable-check` holder politik og manifester i sync.
9. **Registeret er opdateret:** alle beskyttelsesposter og pilotmoduler erklærer
   nu `storageEnforcement.status: "full"` med `deliveredBy: "DKC-048"` og evidens.

Den deterministiske lagerselvtest bærer `verifiedByHuman: false`; den er **ikke**
en målt verifikation på et levende storage-produkt.

## Ændrede og nye filer

Se `evidence/deliverable-files.txt` (49 filer). Hovedgrupper:

- `data-protection/enforcement/immutable-policy.json`,
  `data-protection/src/{enforcement,enforcement-render,enforcement-cli,
  key-protection,storage-semantics,protected-backup}.mjs`,
  `data-protection/test/{worm-store,enforcement,storage-semantics,
  protected-backup}.test.mjs`.
- `storage/src/object-store.mjs` — object-lock/retention/authoritative.
- `contracts/immutable-enforcement.schema.json` + example,
  `conformance/src/immutable-enforcement.mjs`,
  `conformance/test/immutable-enforcement-conformance.test.mjs`,
  `conformance/src/{schemas,validate-schemas}.mjs`.
- `data-protection/records/register.json`, modules' `dataProtection`,
  `data-protection/package.json`, `docs/compliance/protected-data.md`.
- `gitops/manifests/data-protection/` — 7 genererede manifester.
- `Makefile` (`immutable-render/-check/-test` + `ci`),
  `tools/baseline/registry.mjs` (komponent `immutable-enforcement` + 3 checks).
- `release/matrix/test-matrix.json` (1.17.0, `REQ-IMMUTABLE-001`),
  `release/matrix/threats.json` (2 trusler), `docs/security/threat-model.md`,
  `docs/testing/test-matrix.md`.
- `docs/adr/0048-…md`, `docs/adr/README.md`, `docs/spec/immutable-enforcement.md`,
  `docs/spec/README.md`, `docs/spec/data-protection.md`,
  `docs/compliance/immutable-storage.md`, `docs/compliance/README.md`,
  `docs/runbooks/immutable-data-recovery.md`,
  `docs/status/implementation-matrix.md` (regenereret af `make baseline`).

## Testkommandoer og resultat

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — kontrakten validerer med skema + semantik |
| `make lint` | PASS — 493 JSON-filer, 1236 filer |
| `make immutable-render` | PASS — 7 manifester |
| `make immutable-check` | PASS — politik, manifester, register og lagersemantik |
| `make immutable-test` | PASS — 41 data-protection-tests + 7 konformanstests |
| `make data-protection-check/-test` | PASS — DKC-047-håndhævelse + runtime |
| `make storage-check/-test` | PASS — DKC-041-lageret er intakt |
| `make release-check` | PASS — 40 krav, matrixversion 1.17.0 |
| `make supply-chain-sbom` + `make supply-chain-check` | PASS |
| `make test` | PASS — conformance-suiten |
| `make -k ci` | Kun den forud eksisterende `changelog-check` fejler |
| `make baseline` | 149 checks: 116 PASS, 1 FAIL, 32 NOT RUN |

## Acceptkriterier

| # | Kriterium | Status | Evidens |
| --- | --- | --- | --- |
| 1 | Agenten kan hverken skrive, slette, forkorte retention, skifte current-pointer, slette nøgle eller bruge en indirekte adminvej | **PASS** | Rollematrixtestene; `agentDenials` dækker 14 operationer og 7 indirekte stier |
| 2 | Governance-mode bypass er ikke tilgængelig for AI; låst compliance-retention kan ikke omgås af en menneskelig approval | **PASS** | `storage-semantics`-tests `governance-bypass-requires-flag` + `compliance-non-bypassable`; AI-governance nægtes |
| 3 | Ny objektversion skjuler ikke den autoritative låste version | **PASS** | `authoritative()`/`getAuthoritative()` + test "en ny version skjuler ikke…" |
| 4 | Backup/restore bevarer versioner, låse og adgangsregler | **PASS** | `protected-backup.test.mjs` (eksport/import + `compareProtectedState`) |
| 5 | Trusselsmodellens menneskelige/storage-administratorer og fysiske begrænsninger er dokumenteret | **PASS** | `THREAT-IMMUTABLE-001/002`, `docs/compliance/immutable-storage.md`, ADR-0048 |

## Leverancer

| # | Leverance | Status |
| --- | --- | --- |
| 1 | Adskilt storage-/sikkerhedsadministration, agentroller uden delete/update/retention-bypass og beskyttede katalogreferencer | **PASS** |
| 2 | WORM/object-lock for udvalgte versioner og separat append-only rolle til audit-ingest | **PASS** |
| 3 | Beskyt KMS, key deletion, lifecycle, backups, serviceaccounts og trust-config mod AI | **PASS** |
| 4 | Verificér storageproduktets faktiske semantics; S3-kompatibilitet alene er ikke WORM-bevis | **PASS** (live-verifikation NOT RUN) |
| 5 | Menneskelig to-personers kontrol for beskyttelsespolitik og recovery-adgang | **PASS** |

## Ærligt udestående

- `integration-immutable-live` er **NOT RUN**: der findes ingen levende
  S3-/objektlager-instans i dette miljø. Object-lock, rolle-håndhævelse,
  nøglebeskyttelse, to-personers kontrol og backup/restore er efterprøvet
  deterministisk mod den rigtige fillager-model; en målt WORM-verifikation på et
  rigtigt storage-produkt kræver uafhængig driftsverifikation.
- Baseline har fortsat den **forud eksisterende** `changelog-check`-fejl:
  commits (inkl. `83ad91a`) mangler DCO sign-off. Den er ikke indført eller
  skjult af DKC-048.
- Den deterministiske lagerselvtest er `verifiedByHuman: false` og er ikke et
  driftsbevis.
- En konfiguration certificerer ikke et målt beskyttelsesniveau.

## Review-identifikatorer

- Review-base: `5f9fa73`
- Undersøgt checkout: `83ad91a`
- Forudsætnings-overlays: DKC-001..DKC-041 (tip `dkc-041/apply.sh`)
- Denne overlay: `dkc-048/`
- E2E: pakkens `apply.sh` på en frisk `83ad91a`-checkout giver et træ der er
  byte-identisk med arbejdsklonen (`evidence/e2e-tree-diff.txt` er tom).
