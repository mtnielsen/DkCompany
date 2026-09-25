# DKC-018 — Adskil kontraktchecks fra integration og driftsbevis (leverance)

Implementering af **DKC-018** for `mtnielsen/DkCompany`. Bygger på
DKC-001 .. DKC-013, DKC-055, DKC-037, DKC-053, DKC-063, DKC-019, DKC-047,
DKC-056, DKC-014 og DKC-015. `00-core/` i det faktiske repo er fortsat **ikke
ændret**; alt ligger under `01-step1/output/dkc-018/`.

- **Reviewets base:** `5f9fa73457d22583b9948611d5cc3afffec4ae38` (`5f9fa73`)
- **Undersøgt checkout:** `83ad91a963d8055f77c29fb4361455689df95acb` (`83ad91a`)
- **Forudsætnings-overlays:** `dkc-015` → `dkc-014` → `dkc-056` → … → `dkc-001` (kædes af `apply.sh`)
- **Miljø:** Node v22.22.1. **Ingen** klynge, `kubectl`, `tofu`, Docker, `cosign`, `syft` eller `trivy`.

## Forudsætninger og valg

DKC-018 afhænger formelt af DKC-007, DKC-015 og DKC-063. Overlayen lægges oven
på hele stakken via `dkc-015/apply.sh`, som kæder `dkc-014/apply.sh` →
`dkc-056/apply.sh` → … → `dkc-001`. **DKC-015 er valgt som forudsætning, fordi
den er den aktuelle stak-top.**

Forudsætningerne er verificeret i kode, ikke i en statusfelt:

- `runtime/src/evidence.mjs` (DKC-007) binder evidens til digest/commit,
  `runtime/src/runtime.mjs` er fail-closed ved PDP-nedbrud.
- `release/src/gate.mjs` og `release/matrix/test-matrix.json` (DKC-063) skelner
  passed/failed/skipped/not-run/stale/wrong-artifact.
- `tools/baseline/registry.mjs` har niveauerne `fixture`/`contract`/`real`/
  `integration` og `external: true`.
- `contracts/module-manifest.schema.json` har `evidenceRef` for hvert verbum.

## Implementeret adfærd

1. **Ny kontrakt** `contracts/evidence-record.schema.json` (`EvidenceRecord`):
   `mode` (`fixture`/`contract`/`integration`/`runtime`), `result`, `commit`,
   `imageDigest`, `environment`, `upstreamVersion`, `runId`, `capturedAt`,
   `expiresAt`, `producer`, `command`, `artifact` og `digest`, samt en valgfri
   Ed25519-`signature`.
2. **Semantisk validator** `conformance/src/evidence-mode.mjs`:
   - `recordDigest()`/`sealRecord()`/`signRecord()` — SHA-256 over postens
     kanoniske indhold uden `digest`/`signature`; signaturen dækker digesten.
   - `evidenceRecordProblems()`/`assessRecord()` afviser udløbet,
     fremtidsdateret, forkert commit/image/miljø/upstream, uverificeret
     signatur og **manuelt ændret indhold** (`tampered`).
   - `productionBadge()`/`verifyReleaseEvidence()` — et produktionsbadge kræver
     mindst ét `integration`/`runtime`-bevis pr. påkrævet emne, bundet til det
     præcise commit/image/miljø og uudløbet. Fixture/contract alene giver højst
     `fixture-only`.
3. **Offline kontrol** `conformance/src/evidence-mode-check.mjs` (`make
   evidence-mode-check`): validerer eksemplet, probemanifestet og den kanoniske
   fixture-only-regel.
4. **Integration/runtime-prober** `evidence/probes.json`,
   `evidence/src/probes.mjs` og `evidence/src/probe-cli.mjs`
   (`make evidence-probe`): prober bundet til `DKC_PROBE_*`
   (commit/image/miljø/upstream/run-ID). Manglende eller uopnåeligt endpoint
   skrives som `not-run` med begrundelse — aldrig `pass`. Negativ bypass-probe
   (`expectDeny`) fejler, hvis det direkte kald ikke afvises.
5. **Modulmanifestet** `contracts/module-manifest.schema.json`: `evidenceRef`
   kan nu bære `mode`, `commit`, `imageDigest`, `environment`,
   `upstreamVersion`, `runId` og `expiresAt`.
6. **Release-gaten** `release/matrix/test-matrix.json` version 1.3.0:
   `REQ-EVIDENCE-001` kræver `evidence-mode-check`, `evidence-mode-test` og den
   eksterne `evidence-probe-staging`.
7. **CI** `.github/workflows/release-gate.yml`: nyt «Evidence mode stage» og et
   probe-trin (NOT RUN uden binding; gaten afgør sagen).
8. **Negativ bypass** i `conformance/test/evidence-mode.test.mjs` og
   `evidence/test/probes.test.mjs`: direkte endpoint-kald fra utillidtværdig
   adresse eller med rå `x-spiffe-id` afvises, gatewayens ingress afviser
   manglende token, og en frakoblet PDP giver `halted` uden at kalde executoren.

De eksisterende hurtige fixturechecks (conformance-suiten, `make conform-all`)
er **uændrede** og kører fortsat offline.

## Ændrede filer (22 leverancefiler)

| Område | Filer |
| --- | --- |
| Kontrakt | `contracts/evidence-record.schema.json` + eksempel, `contracts/module-manifest.schema.json` |
| Konformans | `conformance/src/evidence-mode.mjs`, `evidence-mode-check.mjs`, `schemas.mjs`, `validate-schemas.mjs`, `conformance/test/evidence-mode.test.mjs` |
| Prober | `evidence/probes.json`, `evidence/src/probes.mjs`, `evidence/src/probe-cli.mjs`, `evidence/test/probes.test.mjs` |
| Release | `release/matrix/test-matrix.json` (1.3.0), `docs/testing/test-matrix.md` |
| Byg/CI | `Makefile`, `tools/baseline/registry.mjs`, `.github/workflows/release-gate.yml` |
| Dokumentation | `docs/spec/evidence-modes.md`, `docs/adr/0034-adskil-kontrakt-og-driftsbevis.md`, `docs/spec/README.md`, `docs/adr/README.md`, `docs/status/implementation-matrix.md` |

Den fulde liste findes i `evidence/logs/deliverable-files.txt` og
`evidence/logs/deliverable-diff.txt`.

## Testkommandoer og resultater

| Kommando | Resultat |
| --- | --- |
| `make validate` | PASS — 53 skemaer, 53 eksempler, 1 evidenspost |
| `make lint` | PASS — 358 JSON-filer, 861 filer |
| `make test` | PASS — 146/146 (inkl. 15 evidensmode-tests) |
| `make evidence-mode-check` | PASS — skema/semantik, 6 prober, fixture-only-regel |
| `make evidence-mode-test` | PASS — 15 + 6/21 |
| `make release-check` | PASS — 26 krav, matrixversion 1.3.0 |
| `make release-test` | PASS — 5/5 |
| `make conform-all` / `make conform-negative` | PASS — suiten grøn, negativ fixture fejler som forventet |
| `make supply-chain-test` | PASS — 31/31 |
| `make evidence-probe` | **NOT RUN/exit 2** — ingen `DKC_PROBE_*`-binding og ingen levende endpoints (forventet) |
| `make baseline` | 82 PASS, **1 FAIL** (pre-eksisterende `changelog-check`), 15 NOT RUN, 0 ERROR af 98 |

Den ene FAIL er den kendte, pre-eksisterende `changelog-check` (commits mangler
DCO-sign-off, inkl. `83ad91a`), identisk med DKC-014/015-baselinerne. Den er
registreret ærligt og er **ikke** ændret eller skjult.

## Acceptkriterier

| Kriterium | Status | Bevis |
| --- | --- | --- |
| Fixture-only modul kan ikke få produktionsbadge | **PASS** | `productionBadge()` returnerer `badge: fixture-only`, `productionReady: false` for et fixture-/kontraktsæt (`conformance/test/evidence-mode.test.mjs`, `make evidence-mode-check`). |
| Udløbet eller forkert imagebundet evidens afvises | **PASS** | `assessRecord()` giver `expired` ved udløb og `wrong-artifact` ved forkert commit/image/miljø/upstream. |
| Frakoblet PDP blokerer den faktiske mutation | **PASS** | Runtime-test: `pdp.decide()` kaster `GovernanceUnavailable` → resultat `halted` (`governance utilgængelig — dødemandsgreb`) og executorlisten forbliver tom. |
| En manuel redigering af PASS i JSON er ikke et godkendt releasebevis | **PASS** | `recordDigest()` matcher ikke efter en ændring af `result` → status `tampered`; `verifyReleaseEvidence()` afviser sættet. En valgfri signatur gør desuden digesten uforfalskelig. |

### Opfyldelse af de tre leverancer

| Leverance | Status | Bevis |
| --- | --- | --- |
| Versionér evidens med mode, commit, image-digest, miljø, upstream-version, run-ID og udløb | **PASS** | `contracts/evidence-record.schema.json` + `conformance/src/evidence-mode.mjs`. |
| Behold hurtige fixturechecks; tilføj integrations- og runtime-prober | **PASS** | `make conform-all` uændret grøn; `evidence/probes.json` + `evidence/src/probes.mjs`. |
| Negative bypass-tests mod direkte endpoints, manglende PDP og forældet evidens | **PASS** | `conformance/test/evidence-mode.test.mjs`, `evidence/test/probes.test.mjs`. |

## Ærlige begrænsninger

- **Ingen kørende installation.** Der findes ingen PDP, audit-service, gateway
  eller runtime i dette miljø, og `DKC_PROBE_*`-bindingen er ikke sat. Den
  eksterne `evidence-probe-staging` er derfor registreret `external: true` og
  rapporteres NOT RUN med begrundelse; den kan ikke give et produktionsbadge.
- **`REQ-EVIDENCE-001` er obligatorisk og release-blokerende**, indtil
  integration/runtime-beviserne faktisk er indsamlet. Det er hensigten.
- **Fixture-only er ikke produktionsstatus.** `make evidence-probe` skriver
  `not-run`, når endpointet mangler; et fixture-pass tæller aldrig som
  driftsbevis.
- **En grøn enhedstest er ikke produktionsstatus.** Uafhængig verifikation er en
  separat menneskelig handling.

## Sådan efterprøves leverancen

```sh
git clone --no-hardlinks /mnt/c/projects/DkCompany /tmp/dkc-018-verify
cd /tmp/dkc-018-verify && git checkout 83ad91a
/mnt/c/projects/DkCompany/01-step1/output/dkc-018/apply.sh /tmp/dkc-018-verify/00-core
cd 00-core && make install
make validate && make lint && make test
make evidence-mode-check && make evidence-mode-test
make release-check && make release-test
cd /mnt/c/projects/DkCompany/01-step1/output/dkc-018
sha256sum -c OVERLAY-MANIFEST.txt
```

`OVERLAY-MANIFEST.txt` dækker `deliverable/`, `evidence/`, `README.md` og
`apply.sh` med pakkerod-relative stier.
