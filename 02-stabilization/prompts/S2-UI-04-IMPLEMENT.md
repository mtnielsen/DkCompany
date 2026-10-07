You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-UI-04/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S2-UI-04 Deliver operations visibility and bounded agent controls

Dependencies: S2-UI-03.

Source hints (confirm against current code):

- `platform/portal/`
- `platform/telemetry-api/`
- `platform/observability/`
- `platform/agent-registry/`
- `platform/backup/`
- `platform/continuity/`

Required implementation:

1. Create an operations overview from real telemetry, job and audit APIs: service health, performance, errors, security findings, backup age and restore-test status. Show timestamps and collection coverage; missing or stale signals are unknown, never healthy.
2. Show each agent identity, its single assigned role, current task, allowed scope, progress and recent audited actions. Separate requesting work from approving it.
3. Connect authorized pause, cancel, credential revocation and escalation controls to actual server mechanisms. Clearly distinguish a requested halt from an acknowledged halt; do not claim already completed actions were reversed.
4. Expose backup history and a safe request for an isolated restore rehearsal through existing job/approval APIs. Do not add arbitrary root/shell controls or unbounded self-healing.
5. Provide plain-language incident details and redacted downloadable diagnostics with tenant-scoped audit links. Preserve protected-data restrictions in dashboards, search and exports.

Acceptance criteria:

1. Real local service failure or stopped telemetry produces a visible degraded/unknown state; fixture-only findings are labeled and cannot make release health appear green.
2. An authorized operator can pause a running bounded agent task and observe acknowledgment and audit; unauthorized and cross-tenant actors cannot control it.
3. Backup status reflects actual jobs and destination checks. A requested rehearsal remains pending/NOT_RUN until executed and verified; rendering a button never counts as a successful restore.
4. Operations pages and diagnostics expose no secrets or forbidden data, and the original failure remains visible if escalation delivery is unavailable.
