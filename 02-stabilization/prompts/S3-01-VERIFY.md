You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S3-01/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
