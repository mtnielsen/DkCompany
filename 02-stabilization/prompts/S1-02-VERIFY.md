You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S1-02/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S1-02 Enforce server-owned protected-data classification

Dependencies: S1-01.

Source hints (confirm against current code):

- `platform/runtime/src/runtime.mjs`
- `platform/data-protection/`
- `platform/runtime/test/protected-data-runtime.test.mjs`

Required implementation:

1. Reproduce review R1 before changing behavior. Resolve data classification from trusted server registry state, never from action.protectedData. Derive the operation from the trusted tool/executor registration rather than action.operation.
2. Define how missing registry data and unavailable classification services fail closed for protected resources; distinguish an explicit ordinary classification from an unknown lookup.
3. Enforce no-AI-access, AI-read-only, append-only and retention-locked restrictions across reads, mutations, retrieval, logging and restore adapters. Caller metadata may only tighten policy, not lower it.
4. Add boundary regressions at runtime and relevant adapter entry points; retain valid ordinary-data workflows.

Acceptance criteria:

1. The paired R1 probe denies both baseline no-AI-access and caller-supplied ordinary/noAiAccess=false variants, with zero executor calls.
2. A mutating verb cannot be disguised as a read by action.operation; unknown or failed classification does not silently allow it.
3. Protected-data decisions preserve tenant scope and mandatory audit without copying forbidden data into logs; permitted ordinary reads still work.
