> Reference requirements only. For work assignment use ../prompts/DKC-XXX.md. References to earlier planning/handoff documents are historical context; this package requires direct implementation.

# Revision 4 — testing, penetration assessment and operational data

These are engineering requirements, not implemented features. Add DKC-063–066 to the existing backlog. Extend existing observability/scanning infrastructure; avoid duplicating functioning subsystems.

## Software quality

DKC-063 defines risk-based acceptance and evidence: unit/contract/integration/end-to-end checks; tenant and permission boundaries; installation, upgrades, schema migrations, exports, restore, performance and failure behaviour. Use the actual deployment profile. Full HA failure evidence is required for HA claims. No arbitrary universal coverage percentage substitutes for testing critical behaviour.

Bind test records to commit, artifact digest, configuration, environment, tool version, actor, command, timestamps and criterion. A changed artifact invalidates relevant evidence until checked. Distinguish failed, skipped, not run, stale and not applicable. A fixture cannot certify an upstream integration.

Secure development needs practices throughout the lifecycle, including vulnerability response; NIST SSDF provides a framework for integrating those practices. This project uses it as guidance, not a certification claim. [NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final).

## Security checks and vulnerability handling

DKC-064 builds on DKC-014/017/018. Reuse maintained code, dependency, secret, image and configuration scanners. Use isolated staging for scoped dynamic checks. Track installed components and their actual versions, including managed host packages. Not every finding has a CVE; permission errors and exposed secrets still require handling.

Normalize findings while preserving source reports. Reconcile build inventory with deployed assets. Prioritize using severity, actual exposure, exploitation evidence and business impact. Remediation requires an owner and deadline; false-positive decisions, compensating controls and risk exceptions have evidence, human ownership and expiry. A clean build scan does not clear an unrelated production image.

## Independent penetration assessment

DKC-065 requires an independent assessment before first customer production and an impact-based reassessment after material trust-boundary changes. Use a selected version of OWASP guidance as an assessment baseline, with additional platform-specific tests. [OWASP WSTG](https://owasp.org/projects/web-security-testing-guide).

Human-approved rules of engagement identify targets, test identities, permitted techniques, time window, excluded services, rate limits, stop conditions, emergency contacts and report handling. Third-party systems require their own authorization. Initial rehearsals use isolated staging and synthetic data. Merely connecting a scanner is not independent penetration testing.

Coverage includes identity and tenant isolation, direct APIs, agent impersonation and role switching, approval replay and artifact substitution, prompt/tool injection, connectors, privileged host operations, telemetry access, immutable storage and recovery bypass. Independent assessors do not implement their own fixes; retests bind to the fixed artifact. If assessor/authorization is unavailable, deliver preparation and leave the release gate outstanding.

## Dashboard-facing operations data

DKC-066 implements the contract in `contracts/operations-data-contract.md`. Use standard telemetry plus separate findings, test/evidence and recovery records. OpenTelemetry describes metrics, logs and traces and their collection/export; it is not itself the vulnerability database, test gate or complete dashboard. [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/).

Required views:

- Availability, latency percentiles, error rates, throughput, capacity and queue lag.
- Error-to-trace-to-deployment correlation and incident status.
- Installed vulnerable components, evidence, priority, owner and remediation status.
- Actual test/release evidence for the deployed artifact.
- Backup freshness, last independently checked restore and replication health.
- AI actions, denied actions, pending approvals, execution outcomes, escalation and resource cost.
- Monitoring coverage, last observation, missing sources and collector health.

Tenant scopes are enforced server-side at ingestion/query/export. Global host telemetry is privileged. Avoid personal data and secrets in signals, labels and trace baggage. Use bounded metric cardinality, retention, redaction and controlled evidence access. Hashes identify artifacts; they do not make an untrusted report authentic.

A dashboard is a read view. Repair controls invoke the ordinary policy/approval/executor path. Missing or stale signals display unknown/incomplete, never green. Do not confuse configurable operational logs with the mandatory durable audit required before protected mutation.

## First demonstrable release

Prove one business module on a supported VPS/local profile through installation, IAM, observations, controlled failure, authorized repair, independent outcome verification, restore and human takeover. HA requires its additional failure evidence. The app catalogue stays broad; implementation remains incremental.

DKC-062 consumes security and telemetry evidence; DKC-033 requires DKC-065. Task priorities indicate engineering urgency, not permission to bypass dependencies or human release decisions.
