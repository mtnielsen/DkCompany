You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-UI-02/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

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
