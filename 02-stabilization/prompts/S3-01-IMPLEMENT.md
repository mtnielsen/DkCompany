You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S3-01/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S3-01 Prepare and validate the authorized staging host

Dependencies: S2-04.

Source hints (confirm against current code):

- `platform/distribution/`
- `platform/infrastructure/`
- `platform/configuration/`

Required implementation:

1. Implement staging preflight/provisioning automation using the approved server specification and supplied connection details. If none are supplied, finish dry-runable code and report the required host/domain/backup inputs; do not purchase resources.
2. Limit deployment credentials to staging. Configure SSH access, explicit firewall/ingress rules, TLS and secret injection; preserve recovery access while changing networking.
3. Record host identity, OS/version, storage layout, component versions and the independent backup failure domain without exposing secrets.
4. Require an authorized executor identity for live host changes, separate from the implementer and verifier; bind the approved deployment to the candidate digest.

Acceptance criteria:

1. Read-only preflight confirms the intended host and backup destination; mismatched environment/host/digest or missing authorization stops deployment.
2. No customer data, main-branch mutation or production credentials are used. A VPS purchase is not triggered by running tests.
3. Recovery access and rollback for host configuration changes are verified before exposing services.
