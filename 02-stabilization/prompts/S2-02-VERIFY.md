You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-02/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
