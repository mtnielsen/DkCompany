# DKC-048 — evidens

- `validate.log`, `lint.log`, `immutable-render.log`, `immutable-check.log`,
  `immutable-test.log`, `data-protection-check.log`, `data-protection-test.log`,
  `storage-check.log`, `storage-test.log` — politik, object-lock, rollematrix,
  nøglebeskyttelse, WORM-låse, lagersemantik, manifester og konformans.
- `release-check.log`, `release-test.log`, `supply-chain-sbom.log`,
  `supply-chain-check.log`, `conformance-suite.log` — regression.
- `baseline.log` — `make baseline` (149 checks: 116 PASS, 1 FAIL, 32 NOT RUN).
- `baseline-summary.txt` — opsummering med den forud eksisterende
  `changelog-check`-fejl (DCO sign-off mangler) og den nye
  `integration-immutable-live` NOT RUN.
- `deliverable-files.txt` — de 49 leverede filer.
- `e2e-apply.log`, `e2e-check.log`, `e2e-test.log`, `e2e-tree-diff.txt` —
  end-to-end-anvendelse af den pakkede `apply.sh` på en frisk checkout; trædiffen
  er tom (byte-identisk).
- `manifest-verify.log` — `sha256sum -c` af `OVERLAY-MANIFEST.txt`.
