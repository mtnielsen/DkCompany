You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-02/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S2-02 Implement a real single-server installation profile

Dependencies: S2-01.

Source hints (confirm against current code):

- `platform/distribution/`
- `platform/configuration/`
- `platform/identity/`
- `platform/approvals/`
- `platform/persistence/`
- `platform/Makefile`

Required implementation:

1. Implement one supported Linux installation path, selecting an OS/runtime/deployment mechanism compatible with the actual code and recording the choice. Prefer the existing deployment approach when viable; do not introduce a second unmaintained orchestrator.
2. Build and wire the minimum real services: identity provider integration, policy, approval service, runtime with a harmless test executor, durable audit, persistent storage and basic health/telemetry. Surface missing service implementations as work to complete, not successful mocks.
3. Provide versioned configuration, validation and defaults for log level, retention, TLS/ingress, tenant identity, managed versus external database and separately configured external backup. Ordinary logging settings must not disable required audit.
4. Deliver preflight, install, status and diagnostics commands with meaningful exit codes, repeatable install behavior and persistent volumes. No embedded development keys or default production passwords; secrets are injected outside Git.
5. Document minimum measured CPU/RAM/disk and supported component versions. Mark the profile non-HA. Make a clean local disposable Linux VM usable before requiring a paid VPS.

Acceptance criteria:

1. A documented command installs and starts real processes from a clean supported Linux VM; replacing installer-live with another NOT RUN echo is not acceptance.
2. Authenticated API calls reach policy and approval services with durable audit. A reboot preserves tenant and approval data.
3. Invalid configuration fails before mutation; repeated installation does not destroy data. Missing secrets/TLS prerequisites cannot yield a healthy deployment.
4. The module dependency resolver selects only the minimal supported stack; unimplemented optional modules are not advertised as installed.
