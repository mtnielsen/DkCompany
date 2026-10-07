You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-UI-04/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
