# ADR-0007: Evidens og prosa adskilles; revieweren kan ikke godkende

- **Status:** accepteret
- **Beslutningstagere:** Platformsejerskab
- **Dato:** 2025-09-01
- **Beslutningsdrev:** Mennesker godkender på prosa, hvis prosaen er der. Det er den mest sandsynlige fejl i hele systemet.

## Kontekst og problemstilling

En agent kan skrive en overbevisende begrundelse, der ikke har noget med ændringen at gøre. Hvis godkenderen møder forklaringen først og evidensen bagefter (eller slet ikke), godkender de fortællingen. Samme problem gælder en reviewer-agent: hvis den kan godkende, bliver den et nyt sted at placere blind tillid.

Evidence i `approval-request` er allerede defineret som **maskingenereret** (policy, tests, dry-run, scans, diff). `agentAssessment` er **agentens prosa**. Kontrakten siger det — men en kontrakt, der ikke håndhæves i visningen, ændrer ikke adfærd.

## Beslutningskriterier

- Godkenderen skal møde diff og evidens, ikke kun prosa.
- Prosa og maskinevidens skal kunne skelnes på et øjekast.
- En påstand i prosaisen skal kunne verificeres deterministisk, når det er muligt.
- Reviewerens beføjelser skal være så små som mulige.

## Overvejede muligheder

- **Bland evidens og prosa i én visning.** Nemt, men fortællingen vinder.
- **Vis kun prosa.** Katastrofalt.
- **Adskil evidens (maskine) og prosa (agent) visuelt, og kræv strukturerede påstande.** Gør afvigelser synlige.
- **Lad revieweren godkende for at spare mennesket.** Flytter ansvaret til et system, der ikke kan bære det.

## Beslutning

1. Approval-UI renderer `evidence` og `agentAssessment` i hver sin, klart farvekodede blok. Diff og evidens står først.
2. `agentAssessment.claims` gør udvalgte påstande deterministisk verificerbare mod `evidenceRef`-stier. Afvigelser vises i en tabel og bruges i agent-konformanstest 1.
3. Reviewer-agenten kan kun `no-objection`, `flag` eller `reject`. Den ser ændring + rådata, ikke forfatterens begrundelse, skal være fra en anden leverandør, og kan ikke ændre autonomiklasse.

## Konsekvenser

- **Positive:** Ansvaret forbliver et sted — hos mennesket. Afvigelser mellem prosa og evidens er synlige og maskinelt checkbare. Reviewerens effekt kan måles (2.7).
- **Negative:** Godkenderen skal forholde sig til evidens, ikke kun en bekvem forklaring. Det er mere arbejde og hensigten.
- **Neutrale:** `sawAuthorRationale` og `reviewerMayApprove: false` er allerede låst i agent-kontrakten; denne ADR gør dem operationelle.

## Mere information

- [`docs/spec/approval-service.md`](../spec/approval-service.md), [`docs/spec/reviewer.md`](../spec/reviewer.md), [`docs/spec/agent-conformance.md`](../spec/agent-conformance.md)
- [`contracts/approval-request.schema.json`](../../contracts/approval-request.schema.json)
