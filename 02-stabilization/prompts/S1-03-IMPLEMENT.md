You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S1-03/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S1-03 Apply tenant and role authorization to every approval endpoint

Dependencies: S1-02.

Source hints (confirm against current code):

- `platform/approvals/src/approval-service.mjs`
- `platform/identity/src/tenant.mjs`
- `platform/approvals/test/`

Required implementation:

1. Reproduce R2 and R4. Authenticate list/read/view/create/decide/revoke/authorize routes, then apply operation-specific resource and tenant authorization consistently.
2. Filter list results by authorized tenant scope; require explicit tenant grants for cross-tenant platform actors. Treat missing tenant identity as denied unless a narrowly scoped platform grant applies.
3. Bind authorizeExecution access to the authenticated executor identity and server-owned request, instead of merely accepting any authenticated caller with a descriptor.
4. Prevent request-ID replacement and external mutation of approval state through returned object references. Apply the same checks to public service methods or explicitly separate trusted internal methods.

Acceptance criteria:

1. Anonymous approval listing returns 401/403 with no request IDs; tenant B cannot list, inspect, decide, revoke or consume tenant A requests.
2. The R2 probe returns 403, leaves the request pending and emits the permitted audit record. Explicit tenant-scoped platform access and legitimate human decisions still work.
3. Duplicate IDs, duplicate approvers, client-supplied identity/groups/training and client-supplied approved state fail safely.
4. HTTP and in-process tests cover both permitted and forbidden calls, including workload versus human actors.
