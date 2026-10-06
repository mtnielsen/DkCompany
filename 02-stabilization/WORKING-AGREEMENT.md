# Roles and delivery rules

## Roles

The human owner owns priorities, risk decisions, spending and final acceptance. This sprint package supplies the planned assignments. An implementer codes the assigned change and runs development tests. A separate verifier inspects and tests the exact source commit. An executor deploys only an accepted artifact to an explicitly authorized target using deployment-scoped credentials. The auditor observes evidence without changing it. No agent identity may hold two roles or be relabeled into another role for the same change. One model may power different agents only when sessions, identities and credentials remain separate.

These prompts describe the collaboration process; they do not replace technical identity, credential, tool and branch enforcement in the product. Implementers do not receive approver/deployment credentials. Verifiers do not receive write/deploy privileges for the change. A human supplies any actual sign-off or live approval.

## Work and dependencies

Use one task branch/PR at a time by default. The ordered tasks deliberately serialize shared runtime and approval files. Do not silently run downstream tasks from unaccepted code. A dependency is satisfied only when its tested implementation commit, separate verification and human acceptance are recorded. Before moving into Sprint 2 or Sprint 3, the human also accepts the sprint exit gate.

The repository's root README identifies this as the current continuation. Preserve 00-core and 01-step1 as historical inputs. S1-01 explicitly replaces the active overlay workflow with maintained platform/ source. Follow the existing contract/conformance and honest capability rules in 00-core/CONTRIBUTING.md; the old instruction that all new work must be another overlay applies only to the archived workflow.

Fetch and inspect the assigned base. Preserve concurrent work, use an isolated branch and never reset another agent's checkout. Reconcile new upstream commits before review, rerunning affected checks. Do not replay the discarded September patch against the new code.

## Completion and evidence

Implementation progress is separate from acceptance: planned -> in-progress -> awaiting-verification; technical verification is PASS, FAIL or NOT_RUN; human acceptance is pending, accepted or rejected. A blocked item names its missing input and which independent work is complete. No task starts as done. Implementers cannot populate verifier or human acceptance fields.

Reports bind to the actual tested source SHA and artifact digest, include exact commands and exit codes, and distinguish local fixtures, live integration and human participation. Evidence-only commits can follow the tested source SHA; any later source change requires renewed verification. Never insert the final evidence commit's impossible self-referential hash. A fresh verifier should compare the candidate source tree against the recorded tested tree.

Record results under evidence/<TASK>/ using the templates. Keep large raw logs in controlled CI artifacts with retention and hashes; commit concise redacted reports and stable artifact references. Do not upload secrets, customer data or security-sensitive payloads. Preserve required audit even when ordinary logs are reduced. Do not manufacture missing historical logs, human names, signatures or pass statuses.

Before CI is restored, verifiers run the available commands independently and label GitHub CI NOT_RUN. After S2-03, a green run on the candidate SHA and active required branch checks are mandatory for the sprint gate. Historical DCO failures must remain visible, without rewriting history or inventing another person's sign-off. New commits follow the established author/DCO process.

## External operations

An implementer may code infrastructure automation, but this handoff does not authorize buying a VPS, using production credentials or changing an unspecified server. Sprint 3 uses supplied staging host details, a named human owner and an approved artifact. Finish tools, config templates and dry runs before asking for genuinely missing access. Never ask the user to paste secrets into chat or Git.

A host-bound executor may perform the specifically authorized staging deployment, with rollback and escalation. It cannot merge or approve the source change. Live human approval exercises require real human participants; test principals prove automated behavior only. Single-server staging is non-HA and uses synthetic data. Real multi-server availability, external immutable storage and customer-production readiness need subsequent measured validation.
