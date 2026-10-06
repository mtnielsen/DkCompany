You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S3-04/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S3-04 Prove upgrade rollback and human takeover

Dependencies: S3-03.

Source hints (confirm against current code):

- `platform/lifecycle/`
- `platform/continuity/`
- `platform/runbooks/`
- `platform/release/`

Required implementation:

1. Execute a controlled upgrade and deliberate failed-release scenario using synthetic state. Validate migration compatibility, rollback to the prior accepted artifact and data integrity.
2. Exercise agent kill switch, credential revocation, escalation and human takeover through a bounded, preapproved recovery runbook. No unrestricted shell/root or self-approval.
3. Produce the staging acceptance report with linked deployment, workflow, backup/recovery and rollback evidence for the exact artifacts.
4. List the next HA/multi-server verification work explicitly: quorum, split brain, partitions, failover, fencing, worker coordination and independent failure domains. These are subsequent work, not claims made by this single-server sprint.

Acceptance criteria:

1. Upgrade and rollback preserve data and permissions; an irreversible migration cannot advertise automatic rollback without a tested recovery alternative.
2. An authorized human can halt agents and take over; unauthorized actors cannot disable audit or mutate protected data.
3. Independent verifier and human owner accept the measured single-server staging evidence. Production/HA readiness remains false until separate live gates are fulfilled.
