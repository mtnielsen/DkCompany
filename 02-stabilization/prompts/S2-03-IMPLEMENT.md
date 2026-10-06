You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-03/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

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
