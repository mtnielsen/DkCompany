You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S3-03/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

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
