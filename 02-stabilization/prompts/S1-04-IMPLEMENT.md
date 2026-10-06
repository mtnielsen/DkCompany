You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S1-04/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

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
