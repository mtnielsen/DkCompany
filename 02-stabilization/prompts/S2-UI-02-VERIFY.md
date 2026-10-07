You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-UI-02/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S2-UI-02 Deliver people, roles and the human approval inbox

Dependencies: S2-UI-01.

Source hints (confirm against current code):

- `platform/portal/`
- `platform/identity/`
- `platform/approvals/`
- `platform/agent-registry/`

Required implementation:

1. Implement company-scoped user enrollment/invitations using the supported identity provider, role assignment and revocation. Do not invent an email delivery success if outbound communication is not connected; provide an explicit pending state or authorized enrollment link.
2. Connect a real approval inbox to the S1-secured approval service. Explain requester, proposed change, affected company/resources, reason, risk, required approvals, expiry and available rollback or recovery in plain language.
3. Implement approve, reject and revoke actions with validation and meaningful progress. Show distinct approvers and outstanding decisions; preserve immutable audit links and actor identity. UI visibility never substitutes for backend authorization.
4. Enforce role separation through authenticated server identities: an implementing agent cannot approve its own work, and a user cannot grant permissions they lack. Handle concurrent decisions, expired approvals and stale pages without double execution.

Acceptance criteria:

1. Through two isolated browser sessions, authorized humans can enroll/revoke a synthetic user and make valid approval decisions; state persists after restart.
2. A company-B user cannot enumerate company-A users, approvals or audit details through the UI or direct API, including guessed IDs and manipulated company selectors.
3. Changed, expired, revoked or insufficiently approved actions never execute; duplicate clicks and concurrent decisions cannot cause duplicate execution.
4. Required actor identities come from real authentication. Automated test principals remain labeled fixtures; claims of live human approval require actual participants.
