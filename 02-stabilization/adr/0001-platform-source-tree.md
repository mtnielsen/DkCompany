# ADR-0001 — `platform/` becomes the maintained source tree

- **Status:** proposed; implemented in S1-01, awaiting independent verification
  and human acceptance
- **Decision drivers:** S1-01 of `02-stabilization/SPRINTS.md`; the 2026-10-06
  review (findings R5 and R8); `WORKING-AGREEMENT.md`
- **Decision record location:** this ADR lives in the stabilization package
  because it changes how the workspace maintains source; the `platform/docs/adr/`
  series continues to record platform runtime architecture decisions.

## Context and problem statement

The 66 historical overlays under `01-step1/output/` are cumulative copies. After
DKC-036, every new change would either become overlay number 67 or be applied by
hand to a checkout that nobody commits. The 2026-10-06 review found that this
workflow produced published shell entry points without execute bits (R5) and a
repository with no automated merge gate (R8). The reviewed assembly also lives
only in throwaway checkouts, so there is no single reviewed source tree.

The human owner authorized the stabilization direction described in
`02-stabilization/README.md`: assemble the historical implementation once into a
maintained directory and continue development there.

## Decision criteria

- Exactly one directory is the maintained source after S1-01.
- Assembly is deterministic, reproducible on a clean Linux checkout and does
  not mutate `00-core/` or `01-step1/`.
- The materialization order follows the historical dependency chain, never
  numeric order; the DKC-002 -> DKC-001 special case is handled explicitly.
- Cycles, missing dependencies, path escapes and symlinks are rejected.
- The assembled tree is committed together with machine-readable provenance
  (base commit, overlay order, per-file source and SHA256, tree digest).
- Review probes keep working against the new path without re-deriving the old
  checkouts by hand.

## Decision

We add a deterministic assembler, `tools/assemble-platform.mjs`, and the
declarative stack `tools/overlay-stack.json`. The assembler materializes
`00-core/` plus all 66 overlays, in the order declared by the historical
`apply.sh` chain (tip DKC-036), into `platform/`, and writes
`platform/PROVENANCE.json`.

- `00-core/` and `01-step1/` are frozen historical inputs. They are not edited
  and are not targets of the assembler.
- All future application changes are made directly in `platform/`, not in new
  overlay packages.
- The root `Makefile` exposes `assemble`, `assemble-check`, `validate` and
  `test`. `assemble-check` proves that the committed `platform/` tree matches a
  fresh deterministic assembly byte for byte.
- `platform/PROVENANCE.json` is generated, never hand-edited. The tree digest
  excludes the provenance file itself because a file cannot hash itself.
- The overlay order and the applied `apply.sh` invocations are cross-checked;
  a mismatch aborts the assembly.
- The generated provenance intentionally contains no timestamp and no absolute
  path, so two clean assemblies produce identical bytes.

## Consequences

- Fixes and reviews bind to one commit under `platform/` instead of a stack of
  copied deliverables.
- The historical method in the root README remains reproducible and is
  preserved unchanged for audit.
- Removing or modifying a historical input after this decision invalidates
  `assemble-check`; later tasks maintain `platform/` directly and therefore
  must not silently regenerate it from the overlays.
- Independent verification of S1-01 must check out the tested commit and run
  `make assemble-check`, the focused suites and the review probes against
  `platform/`. Human acceptance of this ADR is recorded separately from the
  implementation report.

## Alternatives considered

1. **A 67th overlay.** Rejected: it continues the copying workflow the
   stabilization package exists to end.
2. **Assembling into `00-core/` in place.** Rejected: it destroys the frozen
   historical baseline and makes review diffs unreadable.
3. **A generated checkout outside version control.** Rejected: it leaves the
   reviewed tree unpinned and keeps the R8 merge-gate gap.
