You are assigned the IMPLEMENTER role only. Implement the assigned task now; do not respond with another implementation plan.

Read `02-stabilization/README.md`, `02-stabilization/WORKING-AGREEMENT.md`, this task's entry in `tasks.json`, and relevant current code. Use the accepted implementation commits of dependencies, not an old baseline. The 2026-10-06 review is evidence of the reviewed commit, not a claim about future code. Reproduce applicable findings first.

Work on a task branch. Make concrete code, configuration, migrations, documentation and regression changes required by the task. Follow contract -> test -> implementation for changed behavior. You may make local implementation decisions within this assignment and run development tests; you cannot act as independent verifier, approve, merge or deploy your own change. Do not switch this agent's role later. Keep 00-core and 01-step1 historical inputs unchanged; after S1-01 all active code lives in platform/. Do not build another overlay package.

Stop only for a real missing dependency or external input; finish independent authorized work first. Do not pretend mocks, dry runs, old evidence or NOT RUN checks are successful live deployment. Do not spend money, alter production or expose secrets. A dedicated executor performs authorized live operations in Sprint 3.

Return a reviewable PR/diff with the implementation SHA, exact commands/results, changed behavior, limitations and the next verifier prompt. Write `02-stabilization/evidence/S2-01/implementation.json` using the template. Its sourceCommit is the tested code commit; evidence-only commits may follow. Set status to awaiting-verification or blocked, never self-accepted. Do not manufacture human approvals, sign-offs, participant identities or historical logs. Use the repository's established author identity and DCO process for your own authorized new contribution only.

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
