You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S1-01/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
