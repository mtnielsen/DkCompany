You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-04/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S2-04 Prove readiness for VPS staging

Dependencies: S2-03.

Source hints (confirm against current code):

- `platform/release/`
- `platform/distribution/`
- `platform/docs/`
- `02-stabilization/evidence/`

Required implementation:

1. Automate a clean disposable Linux VM exercise: install, synthetic two-tenant login/API flow, service restart, full reboot, failure diagnostics and teardown limited to the test environment.
2. Bind evidence to exact commit/image digests and measured resource use. Derive a VPS sizing and storage specification from that evidence rather than inventing capacity.
3. Create a staging input template for host/SSH identity, domain/DNS, secret references, backup endpoint, allowed CIDRs, named human owner and budget cap; keep credentials out of Git.
4. Implement a readiness gate separating local functional success, GitHub CI, independent verification, human acceptance and missing infrastructure inputs.

Acceptance criteria:

1. The clean-VM run is reproduced independently with real services and persisted state; supported OS/runtime are explicit.
2. All S1 security gates and S2 installation/CI gates are met for the candidate commit. Missing admin settings remain a blocker, not a waiver.
3. The report gives a concrete server specification, backup requirements and operating cost inputs for the human to approve before any purchase.
4. S2 acceptance permits synthetic-data staging only; it does not assert HA, compliance certification or customer-production readiness.
