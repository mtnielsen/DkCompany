# DKC-039 — evidens

- `validate.log`, `lint.log`, `db-ha-render.log`, `db-ha-check.log`,
  `db-ha-test.log`, `db-ha-drill.log` — plan, semantik, manifester og tests.
- `persistence-check.log`, `persistence-tests.log` — v11-migrationer og 74 tests.
- `release-check.log`, `release-test.log`, `supply-chain-check.log`,
  `infrastructure-check.log`, `infrastructure-test.log`, `conformance-suite.log`,
  `jobs-tests.log`, `messaging-tests.log` — regression.
- `baseline.log` — `make baseline` (142 checks: 111 PASS, 1 FAIL, 30 NOT RUN).
- `baseline-summary.txt` — opsummering med den forud eksisterende
  `changelog-check`-fejl.
- `deliverable-files.txt` — de 30 leverede filer.
- `e2e-apply.log`, `e2e-tree-diff.txt`, `e2e-check.log`, `e2e-test.log` —
  end-to-end-anvendelse på en frisk checkout.
