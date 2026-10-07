You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-04/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S2-04 Prove readiness for VPS staging

Dependencies: S2-UI-05.

Source hints (confirm against current code):

- `platform/release/`
- `platform/distribution/`
- `platform/docs/`
- `02-stabilization/evidence/`

Required implementation:

1. Automate a clean disposable full Linux VM exercise: install, complete the real browser setup and synthetic two-company management journey from S2-UI-05, service restart, full reboot, failure diagnostics and teardown limited to the test environment. WSL source tests alone do not prove full-host reboot behavior.
2. Bind evidence to exact commit/image digests and measured resource use. Derive a VPS sizing and storage specification from that evidence rather than inventing capacity.
3. Create a staging input template for host/SSH identity, domain/DNS, secret references, backup endpoint, allowed CIDRs, named human owner and budget cap; keep credentials out of Git.
4. Implement a readiness gate separating local functional success, GitHub CI, independent verification, human acceptance and missing infrastructure inputs.

Acceptance criteria:

1. The clean-VM run is reproduced independently with real services and persisted state; supported OS/runtime are explicit.
2. All S1 security gates and S2 installation, browser usability and CI gates are met for the candidate commit. Missing admin settings or required human usability observations remain a blocker, not a waiver.
3. The report gives a concrete server specification, backup requirements and operating cost inputs for the human to approve before any purchase.
4. S2 acceptance permits synthetic-data staging only; it does not assert HA, compliance certification or customer-production readiness.
