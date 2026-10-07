You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-UI-05/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S2-UI-05 Prove beginner browser workflows and accessibility

Dependencies: S2-UI-04.

Source hints (confirm against current code):

- `platform/portal/test/`
- `platform/acceptance/`
- `platform/docs/`
- `.github/workflows/`
- `02-stabilization/evidence/`

Required implementation:

1. Add a reproducible browser acceptance command against the supported local installation using the exact candidate artifacts. Reuse existing browser tooling where available; pin new dependencies and keep real-service tests separate from isolated UI fixtures.
2. Exercise setup, login, company selection, people/roles, application selection, settings, approval decisions, job progress, agent pause, health and backup inspection without terminal use after bootstrap.
3. Cover denied access, expired sessions, failed network requests, stale telemetry, duplicate submissions, interrupted jobs and service restart. Assertions must inspect persisted server state and effects, not just success messages.
4. Check keyboard-only use, accessible names and focus, narrow layouts, plain-language recovery messages and Danish/English coverage. Provide concise contextual help and an operator recovery guide.
5. Provide a repeatable beginner usability exercise with tasks and observation fields. Record actual participants and difficulties only when a human participates; otherwise report that item NOT_RUN. Feed the browser suite into CI and the S2-04 readiness gate.

Acceptance criteria:

1. A fresh supported local installation passes the browser journey with real services and persistent state. No normal task in the journey requires Git, direct database edits or JSON editing.
2. Browser and direct-API negative cases enforce identical tenant and role boundaries; hidden buttons are not considered authorization tests.
3. Keyboard and responsive-layout checks pass; usability observations are traceable to actual runs and do not claim an accessibility certification.
4. CI stores redacted, retained browser evidence for the exact source/artifact. Missing real-service, CI or required human usability evidence remains explicit and blocks the associated acceptance item.
