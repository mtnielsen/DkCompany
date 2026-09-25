# DKC-041 — evidens

- `validate.log`, `lint.log`, `storage-render.log`, `storage-check.log`,
  `storage-test.log`, `storage-drill.log` — lagerplan, semantik, manifester,
  checksums, scrub/repair, quorum, kundede nøgler, cache/indeks og
  holdbarhedsøvelsen.
- `release-check.log`, `release-test.log`, `supply-chain-sbom.log`,
  `supply-chain-check.log`, `continuity-check.log`, `continuity-test.log`,
  `infrastructure-check.log`, `infrastructure-test.log`, `persistence-check.log`,
  `persistence-test.log`, `gitops-test.log`, `conformance-suite.log` — regression
  og krydsvalidering mod DKC-037 og DKC-038.
- `baseline.log` — `make baseline` (146 checks: 114 PASS, 1 FAIL, 31 NOT RUN).
- `baseline-summary.txt` — opsummering med den forud eksisterende
  `changelog-check`-fejl (DCO sign-off mangler) og den nye
  `integration-storage-live` NOT RUN.
- `deliverable-files.txt` — de 41 leverede filer.
- `e2e-apply.log`, `e2e-check.log`, `e2e-tree-diff.txt` — end-to-end-anvendelse
  af den pakkede `apply.sh` på en frisk checkout; trædiffen er tom
  (byte-identisk).
- `e2e-test.log` — de fokuserede tests i den friske checkout.
