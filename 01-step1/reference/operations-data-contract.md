# Required operations data contract — design input, not an implemented API

Publish versioned schemas and conformance fixtures in the repository under DKC-066. Define backward compatibility and unsupported-version handling. Reuse OpenTelemetry for its native signals; do not wrap every metric point in a custom event envelope.

For structured findings, test runs, recovery and action records define:

| Field group | Required semantics |
|---|---|
| Identity | schema_version, event_id, record_type, source_id; stable IDs and provenance |
| Scope | installation_id, environment_id, resource_id and authorized tenant scope; global records require platform scope |
| Time | observed_at, received_at, source timestamp validation, freshness/expiry policy |
| Version | service/version, artifact digest, deployment_id where applicable |
| Correlation | change_id, incident_id, trace_id and task/run IDs as applicable; no fabricated relations |
| Evidence | access-controlled evidence references, producer identity, tool/version and integrity data |
| Classification | data class, retention class and authorized audience |
| Result | typed payload; explicit unknown/not_run/stale states, not a generic success boolean |

Server-side credentials determine allowed scope; reject tenant/resource spoofing. Caller labels are not authorization. Queries, aggregates, saved views, exports, caches and AI readers obey the same policy.

Payloads:

- Finding: advisory/source identifiers, CVE nullable, installed asset/version, severity and exposure evidence, status, first/last seen, owner, deadline, mitigation, human exception/expiry, fix and retest references.
- Test run: task/criterion, command, exit/result, artifact/config identity, environment, producer role, started/finished, pass/fail/not_run/not_applicable and explanation. Implementer and verifier results remain distinct.
- Recovery: backup set, protected asset scope, completion/freshness, destination class, restore exercise result, measured recovery time/data loss and limits.
- Agent action: agent single-role identity, authorized scope, plan/artifact/runbook digest, human authorization reference, preconditions, execution outcome, fallback and audit reference. No hidden chain-of-thought or secret values.

Define pagination, bounded batch sizes, resource quotas, schema validation, duplicate/replay detection, late-arrival handling and retention deletion. Deduplicate by source plus stable event identity and report replay conflicts; keep source evidence rather than silently overwriting it. Audit storage follows its separate immutability requirements.

Collectors must not mark missing data healthy. Alert on lag/loss and state documented buffering/drop priorities. Metrics may be sampled or dropped according to policy; mandatory audit for protected mutations cannot silently adopt best-effort telemetry semantics.

Minimum contract tests: wrong tenant; forged producer; unauthorized global metric; stale scan; changed artifact; duplicate/conflicting record; malformed payload; oversized batch; collector outage; forbidden evidence link; offboarded user; dashboard adapter replacement.
