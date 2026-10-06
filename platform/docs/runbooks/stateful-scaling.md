# Runbook: skalering af stateful workloads

Stateful workloads (database, broker, objektlager) autoskalerer **aldrig**.
Skalering sker kun efter den signerede runbook
[`runbooks/stateful-scaling.runbook.json`](../../runbooks/stateful-scaling.runbook.json)
og et menneskes godkendelse.

## Hvornår bruges runbooken

- Kapacitetsplanen [`performance/capacity-plan.json`](../../performance/capacity-plan.json)
  viser, at en stateful flaskehals begrænser en lastprofil.
- `make performance-drill` rapporterer en flaskehals på et stateful workload.
- Der er dokumenteret ledig kapacitet og et intakt quorum.

## Forudsætninger

1. Workloaden er sund (`healthcheck`).
2. Quorum er intakt, og der er ikke en igangværende failover.
3. Workloaden erklærer eksplicit, om den er multi-active. En app **uden**
   multi-active-support vinder intet ved at øge replikatællingen; den skal i
   stedet vertikalt opgraderes eller arkitektændres.
4. Replikeringslaget er inden for SLO, og et rollback er testet.

## Trin

1. Åbn en change med runbook-referencen `stateful-scaling@1.0.0` og den
   konkrete digest fra [`runbooks/registry.json`](../../runbooks/registry.json).
2. Indhent to menneskelige godkendelser i `platform-approvers`.
3. Applicér den nye replikatælling via GitOps; GitOps verificerer image-digests
   og labels.
4. Observér `replication-lag` og `healthcheck` i mindst 5 minutter.
5. Ved manglende quorum, stigende replikeringslag eller fejl i postcheck:
   rul tilbage til den forrige replikatælling.

## Rollback

Rollback er `scale` tilbage til den registrerede replikatælling. Det er testet,
fordi replikatællingen er versionsstyret i `performance/capacity-plan.json`.

## Bevis

`conformance/src/remediation-check.mjs` verificerer, at runbooken er signeret og
at katalogets digest matcher filen. Selve skaleringen på en levende klynge er en
ekstern integration og er ikke kørt her.
