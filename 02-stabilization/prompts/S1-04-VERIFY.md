You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S1-04/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S1-04 Bind execution to the effective approval policy

Dependencies: S1-03.

Source hints (confirm against current code):

- `platform/runtime/src/runtime.mjs`
- `platform/runtime/src/clients.mjs`
- `platform/approvals/src/binding.mjs`
- `platform/approvals/src/approval-service.mjs`

Required implementation:

1. Reproduce R3 with two genuine approvals and a PDP decision requiring three. Carry the trusted policy decision into execution authorization and enforce the maximum of current PDP and approval-service requirements.
2. Bind approval verification to tenant, executor/agent identity as applicable, operation, target, parameters, artifact/plan/runbook digest, policy identity/version and expiry. Do not accept a caller-forged lower threshold or bundle version.
3. Validate thresholds as positive integers; enforce distinct eligible approvers, revocation and expiry at consumption. Preserve atomic one-time claims and restart behavior.
4. Add drift, replay, concurrency, unavailable-service and policy-change regressions; support genuinely preapproved standard changes only within the approved runbook scope.

Acceptance criteria:

1. R3 produces zero executions with two of three approvals; three valid approvers for the exact change allow one execution.
2. Increasing the required approval count or changing the trusted policy invalidates insufficient authorization; malformed thresholds fail closed.
3. Changed parameters/artifacts/tenant/target/actor and expired/revoked approvals do not execute; concurrent workers cannot double-consume an approval.
4. Valid bounded runbook execution and valid human-approved changes retain positive test coverage.
