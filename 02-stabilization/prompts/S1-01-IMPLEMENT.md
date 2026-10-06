You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S1-01/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S1-01 Create the canonical platform source tree

Dependencies: none.

Source hints (confirm against current code):

- `00-core/`
- `01-step1/output/dkc-036/apply.sh`
- `01-step1/output/**/deliverable/`
- `README.md`

Required implementation:

1. Implement a deterministic assembler that materializes all 66 overlays in their actual dependency order, ending at DKC-036. Do not sort numerically. Handle the DKC-002 -> DKC-001 special case; reject cycles, missing dependencies and path escapes.
2. Commit the assembled source as platform/. Preserve 00-core/ and 01-step1/ as historical inputs. Future application changes go directly into platform/, not another chain of copied deliverables.
3. Record base commit, overlay order, per-file source and SHA256, and a pre-fix tree digest in platform provenance. Exclude caches, credentials and generated run output. Preserve license and attribution. Make the assembler safe on rerun: refuse an existing nonempty target by default.
4. Add a root validation entry point and update active documentation and an ADR for this migration. Carry contracts, package locks, tests and module manifests across without silently changing semantics.
5. Run the current focused and conformance suites, recording inherited failures accurately. This task establishes the tree; later assignments fix the security defects.

Acceptance criteria:

1. A clean Linux checkout materializes a byte-identical pre-fix platform tree twice without mutating source inputs. Provenance accounts for all 66 overlays and every canonical source file.
2. The assembler rejects an out-of-workspace target, a cycle, a missing predecessor and an attempted traversal; it cannot recursively overwrite user files.
3. Existing review probes can target platform/ and expose the known findings. Missing legacy evidence remains reported; no synthetic replacement logs.
4. All future task source paths resolve to platform/, and no changes are required in 00-core or historical deliverables.
