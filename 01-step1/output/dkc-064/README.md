# DKC-064 — Kontinuerlig sikkerhedskontrol og sårbarhedslivscyklus (leverance)

Implementering af **DKC-064** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-015 og DKC-018. `00-core/` i det faktiske repo er fortsat **ikke
ændret**; alt ligger under `01-step1/output/dkc-064/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-018` → `dkc-015` → `dkc-014` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. **Ingen** Trivy, OSV-scanner, Semgrep, Gitleaks, Docker eller stagingklynge.

## Forudsætninger og valg

DKC-064 afhænger formelt af DKC-014, DKC-018, DKC-055 og DKC-063. Forudsætningerne
er verificeret i kode, ikke i et statusfelt:

- `supply-chain/src/vuln.mjs` og `security/src/normalize.mjs` (DKC-014/003)
  normaliserer scanningsoutput; `release/src/gate.mjs` (DKC-063) skelner statusser;
  `agent-registry/src/handoff.mjs` (DKC-055) håndhæver uafhængig verifikation;
  `conformance/src/evidence-mode.mjs` (DKC-018) binder evidens til commit/artefakt.
- Der fandtes ingen fælles beholdning med ejer, frist, livscyklus, dækning og
  inventarrekonciliation — og ingen måde at forhindre en AI i at undertrykke et
  fund eller en gammel image i at frikende en ny deployeret version.

Opgaven er delvist miljøblokeret: scannerne og en isoleret stagingklynge findes
ikke her. Valget var at implementere hele livscyklus- og valideringsmaskineriet
**rigtigt** og bygge beholdningen fra committede, repræsentative scannerfixtures,
mens de rigtige scannere og dynamisk scanning registreres ærligt som **NOT RUN**.

## Implementeret adfærd

1. **Ny kontrakt** `contracts/vulnerability-inventory.schema.json`
   (`VulnerabilityInventory`): scanningskørsler med mode/dækning/status,
   installerede komponenter med versions- og digestbinding, normaliserede fund,
   menneskelige undtagelser, erklæret dækning og inventarrekonciliation.
2. **Semantiske validatorer** `conformance/src/vulnerability.mjs`:
   - `dedupFindings()` — deterministisk `FIND-<12 hex>` udledt af asset+advisory,
     kilder/aliasser/`fixedVersions`/KEV/EPSS flettes, proveniensen bevares.
   - `computePriority()` — alvor + interneteksponering + multi-tenant +
     forretningspåvirkning + KEV + EPSS; forklarlige faktorer.
   - `effectiveStatus()` — `mitigated`/`false-positive` kræver et navngivet
     menneske; `fixed` kræver en **uafhængig** identitet og rolle; `accepted`
     kræver en gyldig menneskelig undtagelse; udløb genåbner.
   - `coverageReport()` / `reconcileInventory()` — forældet/fejlet/utilstrækkelig
     scanning og ukendt image-digest er `unknown`/`incomplete`, ikke grøn.
3. **Genbrug af scannere** `vulnerability-management/src/scanners.mjs`: Trivy
   (image/IaC), OSV-scanner (afhængigheder), Semgrep (statisk kode) og Gitleaks
   (secrets). En scanner uden output registreres `unsupported` med `0/1` dækning;
   dynamisk ZAP-scanning mod staging er `unsupported` (NOT RUN).
4. **Syntetiske fixtures** `vulnerability-management/fixtures/`: Trivy-, OSV-,
   Semgrep-, Gitleaks- og IaC-rapporter samt en bevidst **falsk** secret-canary
   (`DKC_FAKE_CANARY_NOT_A_REAL_SECRET_0000000000`). Ingen rigtige hemmeligheder.
5. **Beholdning og status** `vulnerability-management/inventory.json` +
   `docs/status/vulnerability-management.md`, genereret deterministisk af
   `vulnerability-management/src/build.mjs` + `render.mjs`.
6. **Release-gate** `REQ-VULN-001` (matrixversion 1.4.0) kræver
   `vulnerability-check`, `vulnerability-test` og den eksterne
   `integration-vulnerability-scan`.
7. **CI** `.github/workflows/security-scan.yml` kører de rigtige scannere, bygger
   beholdningen og håndhæver livscyklusgaten.
8. **SBOM/manifest** regenereret (`release/sbom/platform-sbom.cdx.json`,
   `release/artifacts.json`, `docs/status/supply-chain.md`), fordi den nye
   førstepartspakke ændrer SBOM'en.

## Ændrede filer (37 leverancefiler)

| Område | Filer |
| --- | --- |
| Kontrakt | `contracts/vulnerability-inventory.schema.json` + eksempel |
| Konformans | `conformance/src/vulnerability.mjs`, `conformance/test/vulnerability-conformance.test.mjs`, `conformance/src/{schemas,validate-schemas}.mjs` |
| Domæne | `vulnerability-management/` (policy, inventory, 6 fixtures, 6 kilder, 1 test, package.json) |
| Release | `release/matrix/test-matrix.json` (1.4.0), `release/artifacts.json`, `release/sbom/platform-sbom.cdx.json`, `docs/testing/test-matrix.md` |
| Byg/CI | `Makefile`, `tools/baseline/registry.mjs`, `.github/workflows/security-scan.yml` |
| Dokumentation | `docs/spec/vulnerability-management.md`, `docs/adr/0035-…`, `docs/runbooks/vulnerability-response.md`, `docs/status/{vulnerability-management,supply-chain,implementation-matrix}.md`, `docs/{adr,spec}/README.md` |

Den fulde liste findes i `evidence/logs/deliverable-files.txt`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — 54 skemaer, 54 eksempler, 1 sårbarhedsbeholdning |
| `make lint` | PASS — 369 JSON-filer, 886 filer |
| `make test` | PASS — 156/156 (inkl. 10 sårbarhedstests) |
| `make vulnerability-check` | PASS — beholdning i sync + kontrakt/semantik |
| `make vulnerability-test` | PASS — 10 + 4/14 |
| `make release-check` | PASS — 27 krav, matrixversion 1.4.0 |
| `make release-test` | PASS — 5/5 |
| `make supply-chain-check` / `supply-chain-test` | PASS — SBOM i sync / 31/31 |
| `make security-check` / `security-test` | PASS / 4/4 |
| `make conform-all` / `conform-negative` | PASS |
| `make vulnerability-scan` | **NOT RUN** — ingen scannerbinærer (forventet) |
| `make baseline` | 84 PASS, **1 FAIL** (pre-eksisterende `changelog-check`), 16 NOT RUN, 0 ERROR af 101 |

Den ene FAIL er den kendte, pre-eksisterende `changelog-check` (commits mangler
DCO-sign-off, inkl. `83ad91a`), identisk med DKC-014/015/018-baselinerne. Den er
registreret ærligt og er **ikke** ændret eller skjult.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Syntetiske sårbarheds-fixtures og falske secret-canaries opdages uden rigtige hemmeligheder | **PASS** | `vulnerability-management/fixtures/`; Gitleaks-canaryen opdages og markeres menneskeligt `false-positive`; testen afviser rigtige nøgleformater. |
| En ren rapport for en gammel image kan ikke frikende en anden deployeret version | **PASS** | `reconcileInventory()` giver `unknown` for `legacy-app-image-0.9.0` (digest B) mod en scanning bundet til digest A; en løgnagtig `verified` afvises. |
| Scannerfejl, forældede feeds og ukendt inventar er `unknown`/`incomplete`, ikke nul risiko | **PASS** | `coverageReport()`; den committede beholdning erklærer `dynamic` som `unsupported` og `coverage.complete: false`. |
| Prioritering vægter eksponering og forretningspåvirkning sammen med alvor og udnyttelsesbevis | **PASS** | `computePriority()` + test, der hæver en `high` til `critical` ved interneteksponering/multi-tenant/KEV/EPSS. |
| Kun autoriserede mennesker accepterer restriance; udløb genåbner/eskalerer | **PASS** | `effectiveStatus()` + `exceptionValid()`; test viser `accepted` → `reopened` efter udløb, og at en AI-ejet undtagelse afvises. |
| En implementør kan ikke udgive sin egen rettelse for uafhængigt verificeret eller godkende release | **PASS** | `fixed` kræver `verifiedBy` med anden identitet/rolle; `assertIndependentVerification` (DKC-055) testes; release-gaten afviser implementør-evidence (DKC-063). |

### Opfyldelse af de fem leverancer

| Leverance | Status | Bevis |
| --- | --- | --- |
| Genbrug vedligeholdte scannere til kode, afhængigheder, secrets, images og IaC; dynamisk i isoleret staging | **PASS / NOT RUN** | `scanners.mjs` genbruger Trivy/OSV/Semgrep/Gitleaks; dynamisk ZAP-staging er `unsupported` (NOT RUN). |
| Inventar og SBOM bundet til byggede artefakter + rekonsiliation mod faktisk installerede versioner | **PASS** | `components[]` + `reconcileInventory()`; SBOM/manifest regenereret. |
| Normaliserede fund med kilde-ID, CVE, asset/version, alvor, eksponering, udnyttelsesbevis, ejer, frist, evidens og status | **PASS** | `contracts/vulnerability-inventory.schema.json`; `inventory.json`. |
| Dedup uden at tabe proveniens; advisory-opdateringer, falske positiver, mitigeringer, genåbnede fund og udløbende undtagelser | **PASS** | `dedupFindings()` + `effectiveStatus()` + tests. |
| Verifikation af rettelser på det deployede artefakt og menneskeligt godkendte release-gates; skrivebeskyttet dashboard via DKC-066 | **PASS / delvist** | Uafhængig menneskelig verifikation håndhæves; `inventory.json`/statusdokumentet er den stabile flade for DKC-066. DKC-066's faktiske adapter er en separat opgave (NOT RUN her). |

## Ærlige begrænsninger

- **Ingen rigtige scannere.** Trivy, OSV-scanner, Semgrep og Gitleaks er ikke
  installeret, og der findes ingen isoleret stagingklynge. `make vulnerability-scan`
  og den eksterne `integration-vulnerability-scan` er NOT RUN, og dækningen er
  erklæret **ufuldstændig** i stedet for grøn.
- **Beholdningen er syntetisk.** Den er bygget fra committede fixtures og et
  syntetisk inventar; den er ikke et udsagn om, at repoet aktuelt har disse fund.
- **DKC-066's dashboard-adapter er ikke bygget her.** Beholdningen og
  statusdokumentet er de kontrakter, adapteren skal læse.
- **En grøn enhedstest er ikke produktionsstatus.** Uafhængig verifikation og
  menneskelig release-godkendelse er separate handlinger.

## Sådan efterprøves leverancen

```sh
git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-064-verify
cd /tmp/dkc-064-verify && git checkout 83ad91a
/mnt/c/projects/DkCompany/01-step1/output/dkc-064/apply.sh /tmp/dkc-064-verify/00-core
cd 00-core && make install
make validate && make lint && make test
make vulnerability-check && make vulnerability-test
make supply-chain-check && make release-check && make release-test
cd /mnt/c/projects/DkCompany/01-step1/output/dkc-064
sha256sum -c OVERLAY-MANIFEST.txt
```

`OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
`apply.sh` med pakkerod-relative stier.
