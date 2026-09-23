> Reference requirements only. For work assignment use ../prompts/DKC-XXX.md. References to earlier planning/handoff documents are historical context; this package requires direct implementation.

> Revision 4 package: start with START-HERE.md. Tasks DKC-063–066 add testing, continuous security, independent penetration assessment and operations-data contracts. opgaver.json contains the current dependencies and release gates; earlier revision notes below describe their respective additions.

# Revision 3 — installation, modularity and responsibilities

22 September 2026. Requirements and engineering proposal; these capabilities are not yet implemented or proven. This appendix takes precedence over earlier deployment and agent-role wording. It adds DKC-053–062 to the existing plan: 66 tasks and 169 catalogue entries in total.

## 1. Requirements adopted from the owner

- Install on a supported VPS or local server, with a documented path to multiple servers.
- Select only the business modules required. Communications, HR, BI and Reporting are independent functional packages, with explicit technical dependencies.
- Apply IAM, tenant isolation, policy, audit and security to every function, including APIs, connectors, scheduled jobs, exports and AI tools.
- Configure operational logging, retention, databases, data sources and external backup through a consistent interface.
- Every platform agent has exactly one role. Planning, implementation, independent verification and execution use separate agents. Approvals and accountability belong to humans.
- Offer optional management of the host OS through constrained operations.
- Make components replaceable through documented contracts, supported migrations and compatibility tests.
- Preserve the previously specified backup, deduplication, ITSM/continuity, human escalation, bounded self-healing and AI-immutable requirements.

The proposed boundaries below make these requirements testable. Exact supported OS versions, hardware minimums, provider versions and service targets remain decisions to validate, not advertised capabilities.

## 2. Installation profiles

| Profile | Intended use | Required disclosure and controls |
|---|---|---|
| Single server | Small VPS or local server; a supported production option | Non-HA. Host maintenance causes downtime. External recovery copy, security controls and tested restore remain mandatory. |
| Multiple servers | Resilience and increased capacity | Independent failure domains, quorum/fencing where applicable, redundant entry points and measured failure tests. Several VMs on one physical host do not prove host resilience. |
| Dedicated customer environment | Isolation, capacity or contractual needs | Same contracts and security controls; explicit ownership and service targets. Can itself be single-server or HA. |
| External data services | Managed or customer-operated database/storage/backup | Compatibility checks and a responsibility agreement for each service. An external service is not automatically highly available. |

Host management is a separate opt-in capability in every applicable profile. Initially target a small, named Linux LTS/CPU architecture matrix. Do not promise Windows, every Linux distribution or arbitrary existing servers until tested.

Evaluate one packaging/runtime approach across sizes to limit operational complexity. K3s is a candidate: its documentation describes a complete single-node cluster and joining additional nodes. Selecting it still requires resource, security, upgrade and recovery validation. Its **cluster datastore** is distinct from the databases used by business applications. [K3s quick start](https://docs.k3s.io/quick-start), [K3s datastore options](https://docs.k3s.io/datastore).

“Scalable” must specify what scales: tenants, active users, storage, jobs, AI concurrency and database throughput. Publish measured limits and expansion procedures. Do not assume adding application replicas scales a stateful upstream application.

## 3. Installation and configuration experience

The installer should perform these steps:

1. Select deployment profile, modules and data-service providers.
2. Check OS, resources, disk, DNS/TLS, ports, connectivity and existing services without changing them.
3. Show the dependency graph, resource estimate, changes, downtime and who owns each service.
4. Bootstrap the first human administrator and separate recovery credentials without requiring an already-running IAM service.
5. Apply a signed, versioned installation plan idempotently; report progress and allow recovery from interruption.
6. Verify login, permissions, health, backup/restore and selected application flows.
7. Produce an inventory, recovery instructions and configuration export with secret references rather than secret values.

A fresh installation must not require hand-editing SQL or orchestration manifests. No automatic disk formatting, takeover of an existing schema or host-OS changes hidden inside ordinary app installation.

Use one versioned configuration schema and one authoritative desired state. The UI and declarative configuration interface must use the same validation and change process; neither silently overwrites the other. For a GitOps implementation, the UI creates a governed configuration change rather than an independent second source of truth.

| Configuration | Required behaviour |
|---|---|
| Log level | Per supported service; debug has an expiry and redaction. Operational verbosity cannot disable mandatory audit. |
| Retention | Per data class and purpose, including logs, AI inputs/outputs, backups and derived indexes. Show consequences before applying. |
| Backup | Destination, schedule, encryption, retention, restore owner, recovery objectives and tested backend capabilities. |
| Data services | Built-in/BYO provider, version compatibility, connection validation and scoped credentials. |
| AI | Allowed providers, data classes, tools, budgets, concurrency and external processing boundaries. |
| Operations | Maintenance windows, notifications, escalation roster, resource quotas and approved runbooks. |

Configuration precedence is explicit: installation policy, permitted tenant settings, then permitted module settings. A lower scope cannot weaken mandatory controls. Classify changes as ordinary authorized administration or changes needing additional approval; do not require a new approval for every harmless view preference.

Retention is configurable within the owner's approved rules. Changing a setting cannot bypass a hold or an unexpired immutable lock. Where existing rules conflict, stop and escalate; do not invent a universal retention period. This is an enforcement design, not a legal retention schedule.

## 4. Exactly one role per agent

Enforce roles using identities, credentials, runtime isolation and tool authorization. A role name in a system prompt is insufficient. The project's one-role rule is stricter than the general separation-of-duty concept; do not describe it as a universal requirement of a standard. [NIST separation of duty definition](https://csrc.nist.gov/glossary/term/separation_of_duty).

| Agent role | May do | May not do |
|---|---|---|
| Observer | Read permitted telemetry; create observations and alerts | Plan changes, write code or mutate services |
| Planner | Diagnose from permitted evidence; propose scope, steps, risks and recovery | Implement, execute or approve the proposal |
| Implementer | Produce code/configuration artifacts within the authorized scope; run its own development tests | Change the approved scope, issue independent verification, deploy or approve |
| Verifier | Independently test and assess the exact artifact; report evidence | Modify the artifact, implement the fix or authorize production execution |
| Executor | Execute the exact authorized artifact or runbook with scoped parameters | Generate replacement code, improvise a new plan or approve |
| Auditor | Examine provenance and control evidence; report findings | Change the audited work, run production changes or approve |

There is no AI approver role. Logging one's own work or testing one's implementation is part of that role; it does not authorize signing off another workflow stage. If verification fails, send findings back to the planner/implementer through the controlled workflow.

An agent role is immutable for its lifetime. Role change requires retirement and a separately provisioned identity. Alias creation, a new session, role rotation, delegation or self-created subagents must not let the same logical actor take conflicting stages of the same change lineage. Agent provisioning and role assignments are human-controlled. Separate agents can use the same model, but that does not establish independence of model errors.

The workflow controller is deterministic infrastructure. It routes stage artifacts and verifies signatures; it does not operate as an all-role AI with pooled credentials. Every handoff carries change ID, artifact digest, producer identity/role and evidence links.

Typical flow:

`observation → proposed plan → human scope approval → implementation → independent verification → human approval of exact artifact → constrained execution → independent outcome check`

For routine self-healing, a human may approve a versioned runbook in advance, including allowed scope, expiry, triggers, action limit, rollback and escalation. The executor may use that authorization only when all conditions match. A new action or changed artifact requires a new decision. Emergency access is a separate, audited human procedure.

## 5. Human ownership and escalation

For each process name one accountable human role, its current person and a substitute. Small companies may assign several human responsibilities to one person unless a particular control requires separate people. That does not relax the one-role rule for agents.

| Process | Responsible work | Accountable human | Consultation / escalation |
|---|---|---|---|
| Service scope and service targets | Planner prepares proposal | Service owner | Operators and affected business owner |
| Code/configuration implementation | Implementer | Engineering owner | Planner and verifier through formal handoffs |
| Verification | Verifier | Quality/security control owner | Implementer receives findings |
| Change authorization | Human approver | Change authority | Service/data/security owners as required |
| Authorized production execution | Executor | Operations owner | On-call operator; halt on exceeded bounds |
| Incident response | Observer, planner and executor perform separate stages | Incident commander | Named on-call roster and substitutes |
| Privacy, retention and source ownership | Scoped agents assist | Data owner / designated responsible person | Relevant privacy/legal expertise |
| IAM, role grants and trust roots | Authorized human administration | Security owner | Independent review for privileged changes |
| Backup and disaster recovery | Separate observer/verifier/executor duties | Continuity owner | Data owner and recovery operators |
| Audit and control review | Auditor produces evidence | Control owner | Independent reviewer where required |

No approval response is not an approval. On timeout, hold or halt according to the runbook and escalate to the next named person. Set severity levels, response targets, out-of-band channels and authority to declare a disaster. Human recovery must work when platform IAM, the control plane or the AI provider is unavailable.

## 6. Four distinct kinds of data connection

| Kind | Meaning | Required ownership |
|---|---|---|
| Built-in database service | Platform installs and manages a supported existing engine | Platform operational profile covers patching, migrations, credentials, backup and restore |
| External application database | Customer/provider operates the database used by an app | Explicit split for engine operations, schema migration, access, encryption and recovery |
| External business data source | Read or explicitly authorized write access to ERP, HR, files or another system | Source owner controls authoritative data; connector scopes and permitted processing are documented |
| Backup destination | Independent recovery storage | Destination access, keys, retention, capacity, restore access and deletion protection have named owners |

Use distinct credentials and explicit tenant binding. External source connectors default to read-only. Connection success is not permission to migrate schemas, copy every table or claim the source is backed up.

Configure external object storage first, validating the exact provider's capabilities. Other backend types need their own contract tests. “S3-compatible” alone is not proof of WORM, retention or recovery semantics. Test restore from another machine with the primary environment unavailable. Keys and recovery instructions must survive that failure too.

Declare systems of record for shared business entities such as employees, customers and invoices. Define stable IDs, ownership, synchronization direction, conflict resolution, deletion propagation and reconciliation before connecting modules. Otherwise “integrated” applications produce inconsistent copies.

## 7. Modules and interchangeability

The mandatory core supplies identity, tenant context, policy/role enforcement, protected audit, secret references, configuration and lifecycle control. This is a logical boundary, not a requirement to run dozens of separate services on a small VPS.

Every module manifest declares:

- Version, license, support window and signed artifact references.
- Required and optional dependencies, conflicts and compatible version ranges.
- Capabilities, interfaces, events and required security semantics.
- Data-service requirements, data classes, ownership, migrations and export formats.
- Resource minimums, deployment profiles, network access and external dependencies.
- Backup/restore, retention, upgrades, uninstall, health and permitted operational actions.

The installer resolves transitive dependencies before mutation and explains why each component is present. Shared dependencies cannot be removed while consumers need them. Unknown plugins do not receive core or tenant-wide credentials simply by registering a manifest.

Example: installing Reporting requires the security core, reporting engine and chosen source connector. It does not require HR unless that report actually uses the HR module. Reporting against an external HR source uses its connector and authorization, not an unnecessary second HR application.

Interchangeability has three explicit statuses: compatible provider switch; supported migration with downtime/limitations; unsupported. Database engines, IAM providers and business applications are not universally drop-in replacements. Prove data/ACL/ID coverage, historical audit identity, cutover, rollback limits and credential revocation for supported swaps.

Keep build-task dependencies separate from installed-component dependencies. The task DAG orders engineering work across the full product. It does not instruct every installation to run every module or the HA stack.

## 8. Optional host and OS management

Enroll supported hosts deliberately. Use a restricted deterministic privileged broker for signed, human-approved operation types with validated parameters. Keep its policy, signing authority and installation/update path outside agent control.

Initial operations can include diagnostics, approved package updates, certificate renewal, service drain/restart and planned reboot. Each operation needs prerequisites, maintenance window, limits, outcome checks and a recovery procedure. A general shell, Docker socket, unrestricted sudo or arbitrary uploaded script is not an acceptable broker interface.

Existing configuration-management tooling can execute controlled operations, but its dry-run facility is only part of validation. For example, Ansible documents limitations when modules do not support check mode. Dry-run success is not proof of safe execution or rollback. [Ansible check mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html).

On a single server, updates/reboots can interrupt all local applications; show and accept that downtime. For HA, validate drain, placement and remaining capacity before touching a node. A VPS guest manager cannot promise control of provider hardware or hypervisor.

**Immutable boundary:** if an AI-controlled operation can exercise arbitrary root authority over the host containing the protected data and keys, local application permissions cannot establish strong AI immutability. Restrict reachable operations and keep authoritative immutable copies, retention administration and recovery keys in an independent security domain. Test indirect bypasses, including package/script execution, storage administration and key destruction.

Preserve an out-of-band recovery route. Do not let an automated firewall or SSH change remove the only recovery path. Do not automatically repurpose a shared local server or take over unrelated workloads.

## 9. IAM across Communications, HR, BI and Reporting

Authentication alone is insufficient. Enforce resource-, row- and field-level access where required, including direct upstream APIs and background processing.

- Communications: channel membership, guests, attachments, search, recordings and retention inherit the correct access rules.
- HR: salary, health and personnel records require purpose-specific authorization; ordinary managers and BI users do not automatically receive all HR fields.
- BI: source queries, extracts, caches, dashboards and drill-down views retain tenant and data restrictions.
- Reporting: templates, definitions, parameters, scheduling, export formats, destinations and recipient authorization are explicit. Revalidate rights at execution and delivery; do not rely indefinitely on the report creator's original token.

Test offboarding against sessions, API tokens, shared links, scheduled workflows and AI tools. A page hidden in the UI is not an authorization control. External sources and downstream recipients need an explicit trust and data-sharing contract.

## 10. Remaining items that should be made explicit

1. **Supported environment and capacity:** OS/CPU/version matrix, minimum resources, shared-host restrictions, DNS/TLS and connectivity requirements. Measure installation effort and operating limits.
2. **Bootstrap and recovery:** first administrator, MFA recovery, lost keys, compromised control plane, human break-glass and offline instructions.
3. **Complete lifecycle:** upgrade, schema migration, restore, uninstall versus data deletion, support window, end of life and export/exit. Preserve data by default on ordinary uninstall.
4. **Source of truth and integration rules:** ownership of shared entities, IDs, event delivery, duplicates, ordering, conflicts and schema compatibility.
5. **Failure behaviour:** internet/LLM/IAM/policy/audit outage. Local business functions should continue where safely possible; new privileged mutations must not silently bypass controls.
6. **Software and plugin trust:** signed releases, dependency inventory, vulnerability response, provider compatibility and restricted plugin permissions.
7. **Economics and licensing:** infrastructure, backup, AI, bandwidth, support, required paid editions, budget caps and per-tenant quotas. Replacing subscription apps still has operating costs.
8. **Usability and support:** accessible administration, languages, time zones, diagnostic bundles with redaction and explicit remote-support consent.
9. **Governance:** named human owners, substitutes, escalation deadlines, data-processing decisions and acceptance evidence for each enabled capability.

Choose defaults during architecture work and record unresolved decisions with an owner and deadline. Do not make the installer ask customers to invent an architecture.

## 11. Acceptance and release gates

All profiles need current security, privacy, role-separation and recovery evidence. Optional capabilities have additional gates. A disabled optional immutable product feature does not disable mandatory audit protection.

| Test | Expected evidence |
|---|---|
| Fresh VPS and local-server install | Reproducible install on named supported environments without manual DB edits |
| Interrupted install/upgrade | Resume or documented recovery without silent data loss |
| Selected modules only | Resolved dependency graph matches running components; conflicts rejected before changes |
| Agent role abuse | Multi-role manifests, credential sharing, alias/rotation bypass and self-provisioning rejected |
| Human approval | Changed digests invalidate approval; timeout halts/escalates; no AI approves |
| Configuration | UI/declarative path agree; debug expires; audit cannot be disabled; secrets stay out of outputs |
| Data and backup providers | Compatibility failures are explicit; independent restore proves actual protection |
| IAM across functions | Negative tests cover UI/API/search/cache/export/connector/AI and scheduled delivery |
| Add/remove/replace | Dependency safety, preserved data, migration checks and supported rollback boundaries |
| Host management | Only authorized bounded operations work; out-of-band recovery remains available |
| Provider or internet outage | Declared local functions remain usable; external-dependent functions show accurate status |
| Human takeover | Operators recover without relying on the failed AI/control plane |

DKC-062 aggregates common evidence. HA additionally requires the distributed-storage, queue, recovery, load and failure tests in DKC-038–043 and DKC-050–052. Host management requires DKC-058. Self-healing requires DKC-045–046 plus the applicable human takeover exercise from DKC-052. Immutable capabilities require DKC-047–049 and their bypass tests.

The engineering task DAG covers development of the full product. Release evidence must be selected for the exact deployed profile: the HA scenarios in DKC-051 are not evidence for single-server resilience, and a single-server takeover drill does not prove HA. DKC-052 must report those sub-results separately. Never attach an HA badge to a single-host profile.

## 12. New work packages

| ID | Work |
|---|---|
| DKC-053 | Installation profiles and machine-readable module dependencies |
| DKC-054 | Installer and unified configuration |
| DKC-055 | Enforced single-role agent identities and handoffs |
| DKC-056 | Built-in/BYO data services and external sources |
| DKC-057 | Configurable, independently tested external backups |
| DKC-058 | Optional bounded host/OS management |
| DKC-059 | Component contracts and proven replacement/migration |
| DKC-060 | Cross-function IAM for Communications, HR, BI and Reporting |
| DKC-061 | Updates, removal, support and offline behaviour |
| DKC-062 | Installation, role and profile acceptance with responsibility assignment |

Start DKC-053 after its architecture prerequisites. Complete DKC-055 before enabling the AI execution path. Follow `opgaver.json` for exact task prerequisites, not numerical order. These are planning deliverables; no runtime security guarantee follows from a completed document alone.
