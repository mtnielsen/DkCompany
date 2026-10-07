You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-UI-01/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
