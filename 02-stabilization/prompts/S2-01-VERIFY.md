You are assigned the VERIFIER role only, in a separate agent identity/session from the implementer. You do not implement fixes, approve changes, merge or deploy.

Read `02-stabilization/WORKING-AGREEMENT.md`, the task definition and the implementation report. Check out its exact sourceCommit in an isolated checkout. Independently inspect the diff, reproduce the acceptance commands and add adversarial probes outside the maintained source as needed. Do not trust a completion label or test output supplied by the implementer. Compare the tested tree with the PR head; substantive code changes invalidate the verdict.

Run both positive and negative cases, verify tenant and role scope, and inspect the evidence's source/digest/mode. Distinguish your own results from inherited reports. If a tool, host or human participant is missing, report that acceptance item NOT RUN. Do not mark live requirements passed from fixtures.

Write `02-stabilization/evidence/S2-01/verification.json` with verifier identity, sourceCommit, command exit codes, findings and PASS/FAIL/NOT_RUN. Return findings to the implementer without modifying production code. PASS means technical verification only; a human owner decides acceptance. Never use a GitHub APPROVE review as an AI substitute for that human decision.

# S2-01 Make checkout integrity and path handling portable

Dependencies: S1-05.

Source hints (confirm against current code):

- `platform/conformance/src/manifest.mjs`
- `platform/tools/`
- `01-step1/output/dkc-036/OVERLAY-MANIFEST.txt`
- `.gitignore`
- `.gitattributes`

Required implementation:

1. Fix R7 using platform-aware path containment. Reject absolute and parent traversal references and handle symlink escapes where evidence loading follows links.
2. Provide executable active shell entry points and consistent LF policy, with Windows-compatible developer commands where supported. Do not rewrite the archived overlay history just to make it look green.
3. Create a current artifact manifest containing only actually published source/evidence. Retain an explicit legacy-integrity report listing the 18 absent historical logs; never reconstruct them as original observations.
4. Scope generated artifacts and ignore rules so intended evidence is publishable, secret-bearing files are excluded and immutable audit requirements are preserved.

Acceptance criteria:

1. The prior Windows C-004 failure is fixed; intended Windows developer checks and the supported Linux checks pass.
2. A clean checkout can execute the active installer/validation scripts without manual chmod. The current artifact manifest verifies from a fresh clone.
3. Tampered or missing current files fail verification; historical missing logs are clearly separated from current release evidence.
4. Path traversal and relevant symlink escapes are rejected while valid module-relative references load.
