You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-UI-05/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
