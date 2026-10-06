You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S3-02/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S3-02 Deploy and verify the first real staging workflow

Dependencies: S3-01.

Source hints (confirm against current code):

- `platform/distribution/`
- `platform/identity/`
- `platform/approvals/`
- `platform/runtime/`
- `platform/telemetry-api/`

Required implementation:

1. Deploy the accepted candidate through the controlled staging deployment entry point. Record real endpoint and process/container health, image digests and TLS status.
2. Implement and execute a synthetic two-company workflow: login, create a harmless change request, collect the required distinct human approvals, execute a scoped action, inspect audit, revoke a test user and verify access loss.
3. Test unauthorized cross-tenant operations and the R1-R4 regressions through deployed API boundaries. Human approvals in the live exercise come from real participants; automated fixtures are labeled separate tests.
4. Feed performance/errors and unavailable collectors to the operations view; missing signals show unknown/stale, not healthy.

Acceptance criteria:

1. The workflow reaches real identity, approval, policy and audit components across process boundaries; results are linked by tenant/action/trace identifiers.
2. Two synthetic tenants remain isolated and revoked users cannot retain effective access beyond the documented token/session revocation behavior.
3. Service/PDP/audit failures produce controlled denial or halt, alerts and recoverable operator diagnostics. No unsupported self-healing privileges are added.
