You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S1-05/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
