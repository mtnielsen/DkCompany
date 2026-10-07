# DkCompany stabilization sprints

This package assigns executable coding work to turn the DKC-036 cumulative implementation into a verified, installable single-server staging platform. S1-01 is independently verified on Windows and Linux; the owner authorized continuation. The current assignment is S1-02. It does not claim the 66 historical outputs are a production platform or all business applications.

## Start an agent

Give the implementer `START-IMPLEMENTER.md`. For the current explicit assignment, give it `prompts/S1-02-IMPLEMENT.md`. After it returns a tested source commit, start a different agent with `START-VERIFIER.md` and that task ID/commit. The human owner reviews both outputs. Then assign the next task whose dependencies have been accepted. One agent retains one role throughout; using separate prompts in the same agent does not establish independence.

This package is initially published on `codex/sprint-handoff-20261006`. Agents may branch from it while its PR is open. After acceptance, branch from the current integration/main base containing the accepted dependency commits. Never assume these files are already on main.

## Scope and source of truth

The reviewed baseline is `5e3706b5e7ad569c0ec68c4b63ceeaad15c237a3` (2026-09-25), inspected on 2026-10-06. New commits must be evaluated on their own merits. The first task creates `platform/` by assembling all 66 historical overlays in actual chain order; DKC-036 is the tip. The historical `00-core/` and `01-step1/` remain unchanged. Future application code is maintained directly under `platform/`. Root build/deployment automation may reference that directory. The user authorized this stabilization direction; no separate approval of the routine directory choice is needed.

`SPRINTS.md` gives sequencing and exit gates. `tasks.json` is the machine-readable assignment catalogue. `prompts/` contains a coding prompt and an independent verification prompt for every task. `WORKING-AGREEMENT.md` defines roles and completion. `templates/` supplies truthful, initially unapproved result records. `reference/` contains the prior focused review, reproducible local security probes and candidate app watchlist.

These files instruct future implementation. Publishing this package does not close findings, apply branch protection, authorize spending or approve a deployment. The creative apps remain candidates, not Sprint 1-3 dependencies.

## Expected effort

Budget two initial two-week timeboxes for security/integration and installation/CI, followed by a staging sprint. These are planning estimates, not a promise that missing service wiring will fit. Re-estimate after S1-01 establishes the integrated baseline and after S2-02 proves the real installation. Exit gates determine readiness. Provision the VPS after the Sprint 2 gate; use a disposable local Linux VM for earlier work.

## Browser management delivery

The owner requested a beginner-friendly web interface on 2026-10-07. Sprint 2 now includes S2-UI-01 through S2-UI-05 after the installer and CI foundation, before VPS readiness. These are executable implementation/verifier prompts covering setup/login, people and approvals, applications/settings, operations/agents, and real browser acceptance. Reuse platform/portal and existing backend modules; catalogue descriptions are not proof that business applications work.

This adds work to Sprint 2; re-estimate rather than treating the earlier two-week timebox as a commitment. Keep security tasks S1-02 through S1-05 ahead of privileged management workflows. Ordinary browser operations use the same backend authorization and approval services as every other client.
