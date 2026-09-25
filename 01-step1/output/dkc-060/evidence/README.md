# DKC-060 — evidens

Alle logs er fra den anvendte stak DKC-001..DKC-066 plus DKC-060-overlayen på
checkout `83ad91a` med Node v22.22.1.

| Fil | Kommando | Resultat |
|---|---|---|
| `validate.log` | `node conformance/src/validate-schemas.mjs` | PASS |
| `lint.log` | `node conformance/src/lint.mjs` | PASS |
| `feature-access-check.log` | `make feature-access-check` | PASS |
| `feature-access-test.log` | `make feature-access-test` (54 enheds-/autorisationstests + 8 konformanstests) | PASS |
| `feature-access-demo.log` | `make feature-access-demo` | PASS |
| `release-check.log` | `make release-check` | PASS (35 krav, matrixversion 1.12.0) |
| `release-test.log` | `make release-test` | PASS |
| `supply-chain-check.log` | `make supply-chain-check` | PASS (SBOM regenereret for `feature-access/package.json`) |
| `conformance-suite.log` | `make test` | PASS (210 tests) |
| `baseline.log` | `make baseline` | 103 PASS / 1 FAIL / 26 NOT RUN (130 checks) |
| `baseline-summary.txt` | — | Opsummering af baseline inkl. den forud eksisterende `changelog-check`-fejl |
| `deliverable-files.txt` | — | De 52 filer i `deliverable/`, beregnet ved diff mod en klon med kun DKC-066 |
| `e2e-apply.log` | `dkc-060/apply.sh` på en frisk klon | PASS |
| `e2e-tree-diff.txt` | `diff -rq` mellem e2e-klon og arbejdsklonen | tom (byte-identisk) |

## Nullestilling af runtime-muterede fixtures

`make baseline` muterer 30 sporede filer under `modules/*/conformance` (kendt og
dokumenteret adfærd). Efter baseline blev de 30 filer kopieret tilbage fra et
øjebliksbillede taget før baseline (identisk med referenceklonen med kun
DKC-066 anvendt), og `diff -rq` bekræfter at kun den genererede
`docs/status/implementation-matrix.md` er ændret.

## Kendte grænser

- `changelog-check` fejler før og efter DKC-060: commits mangler DCO sign-off.
- `integration-reporting-delivery` og `integration-idp-offboarding` er NOT RUN:
  der findes ingen rigtig leveringskanal (SMTP/filshare/portal) og ingen rigtig
  IdP/tokenudbyder i dette miljø.
