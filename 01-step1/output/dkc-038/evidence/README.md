# DKC-038 — evidens

Alle logs er fra den anvendte stak DKC-001..DKC-060 plus DKC-038-overlayen på
checkout `83ad91a` med Node v22.22.1.

| Fil | Kommando | Resultat |
|---|---|---|
| `validate.log` | `node conformance/src/validate-schemas.mjs` | PASS |
| `lint.log` | `node conformance/src/lint.mjs` | PASS |
| `ha-check.log` | `make ha-check` | PASS |
| `ha-test.log` | `make ha-test` (14 HA-tests + 8 konformanstests) | PASS |
| `ha-drill.log` | `make ha-drill` (frivillig drain og hårdt nedbrud separat) | PASS (simulering, `målt=false`) |
| `infrastructure-check.log` | `make infrastructure-check` | PASS |
| `infrastructure-test.log` | `make infrastructure-test` (47 tests) | PASS |
| `release-check.log` | `make release-check` | PASS (36 krav, matrixversion 1.13.0) |
| `release-test.log` | `make release-test` | PASS |
| `gitops-test.log` | `make gitops-test` | PASS |
| `supply-chain-check.log` | `make supply-chain-check` | PASS |
| `conformance-suite.log` | `make test` | PASS (218 tests) |
| `baseline.log` | `make baseline` | 106 PASS / 1 FAIL / 28 NOT RUN (135 checks) |
| `baseline-summary.txt` | — | Opsummering inkl. den forud eksisterende `changelog-check`-fejl |
| `deliverable-files.txt` | — | De 47 filer i `deliverable/`, beregnet ved diff mod en klon med kun DKC-060 |
| `e2e-apply.log` | `dkc-038/apply.sh` på en frisk klon | PASS |
| `e2e-check.log` | `make ha-check` i e2e-klonen | PASS |
| `e2e-test.log` | `make ha-test` i e2e-klonen | PASS |
| `e2e-tree-diff.txt` | `diff -rq` mellem e2e-klon og arbejdsklonen | tom (byte-identisk) |

## Nullestilling af runtime-muterede fixtures

`make baseline` muterer 30 sporede filer under `modules/*/conformance` (kendt og
dokumenteret adfærd). Efter baseline blev de 30 filer kopieret tilbage fra et
øjebliksbillede taget før baseline (identisk med referenceklonen med kun DKC-060
anvendt), og `diff -rq` bekræfter at kun den genererede
`docs/status/implementation-matrix.md` og de nye `gitops/manifests/ha/`-filer er
ændret.

## Kendte grænser

- `changelog-check` fejler før og efter DKC-038: commits mangler DCO sign-off.
- `integration-ha-failover` er NOT RUN: der findes ingen levende HA-klynge; en
  målt overtagelse kan ikke udføres her.
- `integration-network-policy-plugin` er NOT RUN: der findes ingen kørende
  Cilium/Calico-installation; politikkerne er kun strukturelt valideret.
