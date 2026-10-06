You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S3-02/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
