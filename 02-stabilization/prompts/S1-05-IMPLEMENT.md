You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S1-05/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S1-05 Create the integrated security acceptance command

Dependencies: S1-04.

Source hints (confirm against current code):

- `platform/runtime/`
- `platform/approvals/`
- `platform/agent-registry/`
- `02-stabilization/evidence/`

Required implementation:

1. Expose one deterministic command that runs the R1-R4 regressions against the maintained platform entry points, alongside identity, role-separation, audit-failure and scope-boundary tests.
2. Keep positive controls and negative controls together. An unavailable audit/PDP/approval service must halt mutations; no agent may implement and approve its own work.
3. Emit a machine-readable report with tested commit, commands, exit codes, durations and evidence hashes. Distinguish local tests from live integrations.
4. Document unresolved integration gaps for Sprint 2; do not claim a full pentest, real HA or production readiness.

Acceptance criteria:

1. All four review security findings are closed with executable regressions and independently rerun evidence for the same source commit.
2. Tests use actual service boundaries where applicable, plus explicitly labeled stubs for external effects, and never customer data.
3. S1 exit package identifies remaining known packaging/platform failures instead of silently skipping them. Human acceptance is separate from this implementation report.
