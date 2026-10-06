You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S1-03/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
