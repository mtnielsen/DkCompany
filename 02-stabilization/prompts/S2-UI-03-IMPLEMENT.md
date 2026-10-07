You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-UI-03/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

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
