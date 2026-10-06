# Review and candidate inputs

The review and probe results describe commit 5e3706b5e7ad569c0ec68c4b63ceeaad15c237a3 assembled through DKC-036 on 2026-10-06. They are historical inputs, not verification of a later fix. Original focused tests passed 216/216; conformance passed 527/528 on Windows; schemas passed. The reported historical 279-check baseline was not independently rerun in that review.

After S1-01, reproduce locally with:

```sh
node 02-stabilization/reference/security-probes.mjs platform ./probe-results.json
```

The script exercises stub executors and an ephemeral loopback service only. It prints observations, not a PASS verdict: exit 0 does not mean secure. Initial vulnerable results include one forbidden read execution, one below-threshold execution, cross-tenant revoke HTTP 200 and anonymous list HTTP 200. Convert these into assertions for the secure behavior in S1-02 through S1-05. Adapt the harness to intentional API changes without removing the attack scenario or positive controls.

The creative-app watchlist preserves the seven upstream links as evaluation candidates. Metadata and documentation were inspected; the applications were not built or tested. Adoption needs workflow/file-format tests, license/asset/brand review and platform IAM/audit/storage integration. They are outside the first three stabilization sprints.
