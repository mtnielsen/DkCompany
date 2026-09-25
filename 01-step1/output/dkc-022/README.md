# DKC-022 — Implementér evidens- og risikoregister

Kumulativ overlay oven på stak-tippet DKC-043. Lægges med
`./apply.sh <checkout>/00-core`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætningskæde:** `dkc-043/apply.sh` → `dkc-042/apply.sh` →
  `dkc-049/apply.sh` → `dkc-021/apply.sh` → … → `dkc-001/apply.sh`.
  DKC-022 afhænger formelt af **DKC-017** (overvågning), **DKC-018**
  (evidensmodes), **DKC-019** (dataregister), **DKC-021** (sletning/legal hold)
  og **DKC-047** (beskyttede dataklasser). Alle er verificeret i den anvendte
  stak: `observability/` + `security/`, `conformance/src/evidence-mode.mjs` +
  `evidence/`, `compliance/data-register.json`, `retention/deletion-policy.json`
  og `data-protection/`.
- **Miljø:** Node v22.22.1. Ingen uafhængig revisor/DPO, ingen faktisk DPIA eller
  produktionsevidence. De statisk fuldt gennemførlige dele er implementeret og
  efterprøvet; den uafhængige vurdering er NOT RUN.

## Implementeret adfærd

1. **Kravregister** (`compliance/assurance-register.json`,
   `contracts/assurance-register.schema.json`): hvert krav har kilde,
   kildedato, ansvarligt menneske, status, kontrolreference og evidenslinks.
   Et krav uden evidens skal stå som `missing-evidence`.
2. **DPIA-screening, databehandleraftaler, underdatabehandlere og
   overførselsvurdering** (`dataProtection`): en udestående screening eller
   overførsel markeres eksplicit som blokerende; subprocessorer krydsrefereres
   mod `compliance/data-register.json`.
3. **AI Act-/NIS2-/GDPR-anvendelighed** efter brug, rolle og sektor, hver
   vurderet af et navngivet menneske (`applicability`).
4. **Incidentproces, adgangsrevision, informationspligt og kundens
   exitprocedure** (`incidentAndExit`) med navngivne ejere og refererede
   procedurer (`docs/runbooks/incident-response.md`,
   `docs/runbooks/customer-exit.md`).
5. **Risici og beslutninger** (`risks`, `decisions`): en åben høj/kritisk
   material risiko blokerer en persondatapilot, og hver åben
   juridisk/organisatorisk beslutning har en ansvarlig person.
6. **Evidenspakken** (`compliance/src/assurance.mjs`,
   `contracts/evidence-package.schema.json`): `assembleEvidencePackage` genbruger
   `conformance/src/evidence-mode.mjs` og afviser udløbet, artefakt-mismatchet
   og manuelt ændret evidens med en stabil årsag. Den skelner automatiseret
   evidens (`fixture`/`contract`/`integration`/`runtime`), manglende vurderinger
   og menneskelige beslutninger. `notACertification` og
   `complianceStatus: not-certified` forbliver sande; `productionReady` kræver
   produktionsevidence uden blokere.
7. **Autoriseret accept** (`compliance/src/assurance-service.mjs`,
   `compliance/src/assurance-ledger.mjs`): default-deny læsning, kun et
   verificeret menneske med accept-rolle kan acceptere, med en begrundelse og
   et andet subject end kravets ejer. Hver accept bevares i en hash-kædet
   append-only journal; en ændret journal opdages.
8. **Brudøvelse** (`compliance/src/incident-drill.mjs`): en deterministisk
   øvelse beregner indberetningsfristerne (GDPR 72 t, NIS2 24 t) og kræver et
   navngivet menneskes beslutning om anmeldelse/kommunikation; beslutningen
   dokumenteres i rapporten.
9. **Konformansvalidering** (`conformance/src/assurance.mjs`,
   `conformance/src/validate-schemas.mjs` afsnit 33): skema plus
   beslutningssemantik og ikke-certificering.

`docs/compliance/assurance.md` genereres fra registeret med
`make assurance-write`, og `make assurance-check` afviser den, hvis den er ude
af trit.

## Ændrede filer

39 filer (0 slettede): se `evidence/deliverable-files.txt`. De vigtigste:

- `compliance/assurance-register.json` + `compliance/src/{assurance,assurance-service,assurance-ledger,incident-drill,assurance-cli}.mjs`.
- `contracts/{assurance-register,evidence-package}.schema.json` + 2 eksempler.
- `conformance/src/assurance.mjs`, `conformance/src/schemas.mjs`,
  `conformance/src/validate-schemas.mjs`,
  `conformance/test/assurance-conformance.test.mjs`.
- `compliance/test/{assurance,assurance-service}.test.mjs`.
- `docs/{spec/assurance.md, compliance/assurance.md,
  compliance/dpia-and-transfers.md, compliance/incident-access-exit.md,
  runbooks/incident-response.md, runbooks/customer-exit.md,
  adr/0053-…md, adr/README.md, spec/README.md, compliance/README.md}`.
- `evidence/records/*.evidence.json` (5 syntetiske, forseglede evidensposter).
- `Makefile` (`assurance-write`, `assurance-check`, `assurance-test`,
  `assurance-export`, `assurance-drill` + `ci`),
  `tools/baseline/registry.mjs` (komponent `assurance` + 5 checks),
  `release/matrix/{test-matrix,threats}.json` (REQ-ASSURANCE-001 + 2 trusler),
  `docs/{testing/test-matrix.md, security/threat-model.md,
  status/implementation-matrix.md}`.

## Testkommandoer og resultater

Kørt i den arbejdsklonede stak (DKC-043 + DKC-022). Alle nedenstående er PASS i
`evidence/`-loggene:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `make validate` | PASS | `evidence/validate.log` |
| `make lint` | PASS | `evidence/lint.log` |
| `make assurance-check` | PASS | `evidence/assurance-check.log` |
| `make assurance-test` | PASS (28 + 6 tests) | `evidence/assurance-test.log` |
| `make assurance-export` | PASS (badge `fixture-only`, ikke production) | `evidence/assurance-export.log`, `evidence/assurance-package.json` |
| `make assurance-drill` | PASS (dokumenteret beslutning) | `evidence/assurance-drill.log` |
| `make compliance-check` | PASS | `evidence/compliance-check.log` |
| `make data-register-check` | PASS | `evidence/data-register-check.log` |
| `make release-check` | PASS (45 krav, matrixversion 1.22.0) | `evidence/release-check.log` |
| `make release-test` | PASS | `evidence/release-test.log` |
| `make evidence-mode-check` | PASS | `evidence/evidence-mode-check.log` |
| `make supply-chain-check` | PASS | `evidence/supply-chain-check.log` |
| `make test` | PASS (284 tests) | `evidence/test.log` |
| `make baseline` | 129 PASS, 1 FAIL, 37 NOT RUN af 167 | `evidence/baseline.log`, `evidence/baseline-summary.txt` |

E2E på en frisk klon med kun pakkens `apply.sh`:

| Kommando | Resultat | Log |
| --- | --- | --- |
| `./dkc-022/apply.sh <clone>/00-core` | PASS | `evidence/e2e-apply.log` |
| `make install` | PASS | `evidence/e2e-install.log` |
| fokuseret kontrol (`validate`, `lint`, `assurance-check`, `assurance-test`, `assurance-drill`, `release-check`) | PASS | `evidence/e2e-check.log` |
| `make test` | PASS | `evidence/e2e-test.log` |
| træ-diff mod arbejdsklonen | byte-identisk | `evidence/e2e-tree-diff.txt` |

### Baseline

`make baseline` giver **129 PASS, 1 FAIL, 37 NOT RUN, 0 error af 167 checks**.
Den ene FAIL er den kendte, forudgående **`changelog-check`**: commits i
checkoutet mangler DCO sign-off (også `83ad91a`). Den er ikke "rettet" eller
skjult. De fire nye real-/contract-checks (`assurance-check`, `assurance-test`,
`assurance-export`, `assurance-drill`) er PASS, og
`integration-assurance-independent` er NOT RUN med en præcis begrundelse.
Baseline muterer som vanligt 30 sporede filer under `modules/*/conformance`;
snapshottet blev gendannet bagefter, og `diff -rq` viste ingen afvigelser.

## Acceptkriterier

| # | Kriterium | Resultat | Evidens |
| --- | --- | --- | --- |
| 1 | En ansvarlig person har vurderet hver åben juridisk/organisatorisk beslutning | PASS | `decisions[].responsible` + `ownerDecision`; `assurance/test` (afvisning af ansvarlig-løs/åben beslutning) |
| 2 | Automatisk kontrolmapping beskrives ikke som certificering | PASS | `certificationClaim: false`, `notACertification: true`, `complianceStatus: not-certified`; `assurance-package`-semantik |
| 3 | Brudøvelse gennemføres og beslutninger om anmeldelse/kommunikation dokumenteres | PASS (mekanisme) | `make assurance-drill` + `compliance/test/assurance.test.mjs`; selve den rigtige øvelse/den faktiske beslutning er en menneskelig handling (NOT RUN, `integration-assurance-independent`) |
| 4 | Pilot med persondata er blokeret ved uafklarede væsentlige risici | PASS | `pilotBlockers` (pending DPIA, overførsel, åben beslutning, material risiko); `make assurance-check` rapporterer 4 blokere |
| 5 | Forældet eller artefakt-mismatchet evidens afvises | PASS | `evidence-mode`-genbrug; tests for `expired`, `wrong-artifact`, `tampered` |
| 6 | Uautoriseret accept afvises | PASS | `assurance-service` default-deny, demo-/workload-afvisning, self-accept-forbud |
| 7 | Eksport erklærer ikke platformen compliant eller production-ready | PASS | `acceptedBy: null`, `notACertification: true`, `productionReady: false`; eksport efter accept-test |

## Leverancer (formelle)

1. **DPIA-screening, databehandleraftaler, underdatabehandlere og
   overførselsvurdering** — PASS (struktureret i registeret, krydsrefereret mod
   dataregisteret).
2. **AI Act- og NIS2-anvendelighed efter brug, rolle og sektor** — PASS.
3. **Incidentproces, adgangsrevision, informationspligt og kundens
   exitprocedure** — PASS (med navngivne ejere og procedurer).
4. **Kravregister med kilde, dato, ansvarlig, status og evidenslink** — PASS.

## Grænser og resterende arbejde

- Der findes ingen uafhængig revisor/DPO i dette miljø. En faktisk DPIA, en
  faktisk overførselsvurdering, en rigtig brudøvelse med en faktisk
  anmeldelsesbeslutning og en målt produktionsevidence kræver et navngivet
  menneske eller et eksternt system og er **NOT RUN**
  (`integration-assurance-independent`).
- Evidensposterne er syntetiske `fixture`/`contract`-poster; pakken forbliver
  derfor `fixture-only` og kan ikke nå `production`.
- `changelog-check` forbliver den ene kendte FAIL (manglende DCO sign-off).

## Verifikation

Manifestet er selvkonsistent: alle hashes i `OVERLAY-MANIFEST.txt` er
verificeret med `sha256sum -c` (se `evidence/manifest-verify.log`, der ikke
indeholder sin egen linje). `evidence/e2e-tree-diff.txt` viser, at en frisk
klon med kun denne pakkes `apply.sh` er byte-identisk med arbejdsklonen.
