You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-UI-03/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S2-UI-03 Deliver application selection and validated settings

Dependencies: S2-UI-02.

Source hints (confirm against current code):

- `platform/portal/`
- `platform/distribution/`
- `platform/configuration/`
- `platform/lifecycle/`
- `platform/provider-registry/`

Required implementation:

1. Build an application/component catalogue from the actual distribution manifest. Distinguish installed, installable, unavailable and planned capabilities. HR/BI/communications catalogue entries do not prove those applications are implemented.
2. Provide install, update and removal previews with dependencies, conflicts, version compatibility, data impact and recovery options. Submit durable jobs through the approved lifecycle APIs; do not execute shell commands supplied by the browser.
3. Expose validated settings for managed or external databases, external data connections, separately configured external backup, retention and ordinary logging levels. Preserve required audit and protected-data rules regardless of UI settings.
4. Keep credentials behind server-managed secret references with masked UI values. Connection tests must be tenant-scoped, bounded and protected against arbitrary internal-network access. Prevent secret exposure in URLs, responses, logs and exports.
5. Show desired versus actual configuration, durable job progress, failures and safe retry/resume. Destructive actions require a clear impact preview and the platform approval policy; never silently uninstall dependencies or delete application data.

Acceptance criteria:

1. A browser can select a supported component, review its dependencies, submit the approved operation and observe actual persistent installation state using real local services.
2. Invalid dependencies, insufficient permissions, tenant substitution and conflicting updates fail safely. Removing a required component cannot silently break another installed component.
3. Database/backup connection settings and log/retention edits validate and persist; mandatory audit and data protection cannot be disabled by manipulated requests.
4. Secrets stay masked and are absent from ordinary diagnostics and browser URLs. Jobs recover after service interruption without repeating destructive operations.
