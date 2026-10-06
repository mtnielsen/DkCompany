# Sprint assignments

Sequence follows dependency acceptance, not calendar dates. Two-week timeboxes are estimates. If a required check is NOT_RUN, the relevant exit gate is still pending.

## Sprint 1 Security and integrated source

| Task | Coding outcome | Depends on |
| --- | --- | --- |
| [S1-01](prompts/S1-01-IMPLEMENT.md) | Create the canonical platform source tree | none |
| [S1-02](prompts/S1-02-IMPLEMENT.md) | Enforce server-owned protected-data classification | S1-01 |
| [S1-03](prompts/S1-03-IMPLEMENT.md) | Apply tenant and role authorization to every approval endpoint | S1-02 |
| [S1-04](prompts/S1-04-IMPLEMENT.md) | Bind execution to the effective approval policy | S1-03 |
| [S1-05](prompts/S1-05-IMPLEMENT.md) | Create the integrated security acceptance command | S1-04 |

Exit gate: R1-R4 closed by independent reproductions; canonical source maintained directly; scope, roles and audit fail closed.

## Sprint 2 Reproducible installation and CI

| Task | Coding outcome | Depends on |
| --- | --- | --- |
| [S2-01](prompts/S2-01-IMPLEMENT.md) | Make checkout integrity and path handling portable | S1-05 |
| [S2-02](prompts/S2-02-IMPLEMENT.md) | Implement a real single-server installation profile | S2-01 |
| [S2-03](prompts/S2-03-IMPLEMENT.md) | Run reproducible checks in GitHub CI | S2-02 |
| [S2-04](prompts/S2-04-IMPLEMENT.md) | Prove readiness for VPS staging | S2-03 |

Exit gate: Fresh supported Linux VM installs real services; current evidence verifies; CI and branch review gates active; approved VPS specification derived from measurements.

## Sprint 3 Live single-server staging

| Task | Coding outcome | Depends on |
| --- | --- | --- |
| [S3-01](prompts/S3-01-IMPLEMENT.md) | Prepare and validate the authorized staging host | S2-04 |
| [S3-02](prompts/S3-02-IMPLEMENT.md) | Deploy and verify the first real staging workflow | S3-01 |
| [S3-03](prompts/S3-03-IMPLEMENT.md) | Prove persistence and independent backup recovery | S3-02 |
| [S3-04](prompts/S3-04-IMPLEMENT.md) | Prove upgrade rollback and human takeover | S3-03 |

Exit gate: Authorized staging deployment and synthetic workflow validated; independent backup restores to replacement instance; upgrade/rollback and human takeover measured.

## After these sprints

Plan a separate HA validation sprint for multiple independent servers, quorum/fencing, network partitions and worker coordination. Expand business applications after one real workflow is reliable. HR, BI, reporting and the creative candidate applications are not represented as complete by these stabilization tasks.
