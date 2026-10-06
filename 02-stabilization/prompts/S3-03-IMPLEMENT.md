You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S3-03/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

# S3-03 Prove persistence and independent backup recovery

Dependencies: S3-02.

Source hints (confirm against current code):

- `platform/backup/`
- `platform/persistence/`
- `platform/continuity/`

Required implementation:

1. Run a consistent encrypted backup of synthetic platform state to the configured independent destination with separately scoped credentials.
2. Restore into an isolated replacement instance, validate records, tenant ACLs, approval state and audit continuity, then test retention/holds and credential recovery.
3. Measure backup age, acknowledged records recovered, recovery time and any actual loss against the declared profile RPO/RTO. Exercise restart and storage errors without destroying the only viable backup.
4. Preserve protected-data restrictions and deletion/hold semantics during restore. Record any unsupported WORM enforcement rather than representing a local flag as immutable storage.

Acceptance criteria:

1. Recovery succeeds without reading the original instance data volumes; the backup is not merely another directory on the same server.
2. Recovered data and authorization are validated per tenant; logs contain no secrets or forbidden payloads.
3. Measured results meet the approved staging profile objectives or the gate fails with actual measurements. An unexecuted drill is NOT RUN.
