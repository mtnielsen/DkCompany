You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S1-02/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

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
