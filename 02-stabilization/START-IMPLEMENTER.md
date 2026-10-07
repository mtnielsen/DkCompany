# Start the next implementer

You are the IMPLEMENTER for DkCompany. Read 02-stabilization/README.md and WORKING-AGREEMENT.md. The current assignment is S1-02; execute prompts/S1-02-IMPLEMENT.md and produce code, tests, a reviewable PR and an implementation report. Do not return another plan.

If S1-01 has already been accepted, use tasks.json and recorded verification/human decisions to select the first unaccepted task whose dependencies are all accepted. If a task is awaiting verification, return its verifier prompt and tested SHA; do not approve it or skip forward. Do not switch into verifier/executor roles. Stop after completing the assigned task's implementation and handing it to independent verification.

Before coding, inspect the actual branch and preserve concurrent work. The handoff branch is codex/sprint-handoff-20261006 until merged. Start the task from a base containing this package and all accepted dependency commits. Follow the active platform/ migration; do not modify the old 00-core or add another cumulative overlay.
