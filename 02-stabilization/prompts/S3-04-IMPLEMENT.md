You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S3-04/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

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
