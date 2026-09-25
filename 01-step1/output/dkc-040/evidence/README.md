# DKC-040 — evidens

- `focused-tests.log` — de fokuserede kommandoer samlet.
- `validate.log`, `lint.log`, `messaging-check.log`, `messaging-test.log`,
  `persistence-check.log`, `persistence-tests.log`, `jobs-check.log`,
  `jobs-tests.log`, `conformance-suite.log`, `release-check.log`,
  `release-test.log`, `supply-chain-check.log`, `infrastructure-check.log`,
  `infrastructure-test.log` — rå logfiler.
- `baseline.log` — `make baseline` (138 checks: 108 PASS, 1 FAIL, 29 NOT RUN).
- `baseline-summary.txt` — opsummering med den forud eksisterende
  `changelog-check`-fejl.
- `deliverable-files.txt` — de 33 leverede filer.
- `e2e-apply.log`, `e2e-tree-diff.txt`, `e2e-check.log`, `e2e-test.log` —
  end-to-end-anvendelse på en frisk checkout.
