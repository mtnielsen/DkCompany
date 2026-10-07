You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-UI-01/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S2-UI-01 Deliver browser bootstrap, login and the management shell

Dependencies: S2-03.

Source hints (confirm against current code):

- `platform/portal/`
- `platform/identity/`
- `platform/installer/`
- `platform/configuration/`

Required implementation:

1. Extend the existing portal and supported installation profile. Deliver a documented bootstrap command that starts an actual local setup page and prints its address. Reuse the current rendering approach unless a concrete requirement justifies a new frontend dependency.
2. Implement a resumable first-run wizard for administrator enrollment, company creation and identity-provider setup. Bootstrap authority must be local or bound to a short-lived single-use setup credential; disable it after enrollment. Never ship a default administrator password or log setup secrets.
3. Wire login, logout, session expiry and company selection to the real identity service and server-validated sessions. Apply secure session handling, CSRF protection on cookie-authenticated mutations, output escaping and server authorization. Company selection is not a tenant grant.
4. Build a responsive management shell with Home, Approvals, Applications, People, Agents, Operations and Settings navigation. Only advertise working capabilities as available; show unavailable integrations honestly.
5. Use plain-language Danish and English messages, persistent field labels, keyboard navigation, visible focus and clear loading/empty/error states. Daily administration must not require editing JSON or running shell commands.

Acceptance criteria:

1. From a clean supported local Linux VM, the documented bootstrap command opens the real setup workflow; completing it persists the administrator and company and survives a service restart.
2. A second browser cannot replay enrollment or seize bootstrap access; anonymous, expired-session and cross-company requests are denied server-side, including direct API calls.
3. A real browser can sign in, navigate, switch only among authorized companies and sign out in Danish and English. Tests use real local services; synthetic users are explicitly labeled.
4. Automated browser checks cover keyboard navigation and accessible form names; a human usability exercise is reported separately and never fabricated.
