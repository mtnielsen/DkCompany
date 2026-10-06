You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-03/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S2-03 Run reproducible checks in GitHub CI

Dependencies: S2-02.

Source hints (confirm against current code):

- `.github/workflows/`
- `platform/Makefile`
- `platform/release/`
- `00-core/.github/scripts/check-dco.sh`

Required implementation:

1. Add root GitHub workflows for PRs and main covering clean checkout, current artifact integrity, schema checks, focused security regressions, conformance, build and a minimal service integration smoke test.
2. Pin third-party Actions to reviewed immutable commits and use least-privilege workflow permissions. PR validation must not receive deployment secrets or run untrusted code with elevated tokens.
3. Check DCO for newly introduced commits using an explicit trusted base; report historical unsigned commits separately without altering history or suppressing new violations.
4. Produce actual SBOM/scanner results where supported; unavailable scanners or required integrations cannot silently pass. Configure artifact retention and redaction.
5. Supply an idempotent branch-protection configuration/checker and exact required-check names. Apply repository settings only with repository-admin authorization; if access is missing, report that specific gate pending while finishing all code.

Acceptance criteria:

1. The actual GitHub PR run at the tested SHA completes the required jobs; local make output alone is not a GitHub CI result.
2. A negative fixture/security regression causes a failing required job, and unsigned newly introduced commits fail the DCO job.
3. Main requires passing checks and independent human review, or the report explicitly leaves admin activation pending. No automatic self-approval or bypass.
4. Workflow failure and missing jobs cannot be summarized as a passing release.
