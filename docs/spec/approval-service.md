# Approval-service

**Kode:** [`approvals/`](../../approvals)
**Kontrakter:** [`approval-request.schema.json`](../../contracts/approval-request.schema.json)
**Backlog:** 2.4

## Formål

En A3-handling kan ikke merges uden et menneske. Servicen håndhæver godkendelseskrav, approver-grupper, udløb og træningskrav — og renderer maskinevidens adskilt fra agentens prosa.

## Adskillelse af evidens og prosa

Payloaden har to blokke:

- `evidence` — **maskingenereret** (policy, tests, dry-run, scans, diff). Må ikke skrives af en LLM.
- `agentAssessment` — **agentens prosa**. Er ikke evidens.

Visningen (`GET /v1/approvals/:id/view`) renderer dem i hver sin visuelt adskilte blok: grøn "MASKINE · EVIDENS" og rød "AGENT · PROSA (ikke evidens)". Godkenderen ser diff + evidens først, ikke kun prosa.

## Verificerbare påstande

Prosa kan ikke tjekkes maskinelt. `agentAssessment.claims` gør den delvist checkbar: hver påstand peger på en `evidenceRef` (fx `change.diff.summaryStats.filesChanged`) med operator og værdi. `checkClaims()` verificerer dem deterministisk og viser afvigelser i tabellen. Det er grundlaget for agent-konformanstest 1.

## Håndhævelse

| Krav | Effekt |
| --- | --- |
| `eligibleGroups` | Godkender uden for gruppen → `403` |
| `requiredTrainingModules` | Manglende træningsmodul → `428` (AI Act art. 4) |
| `requiredApprovals` | Færre godkendelser → ikke `approved` |
| `expiresAt` | Forældet anmodning → `410 expired`; gammel evidens skal ikke genbruges |
| `merge-check` | Kun `approved` er `mergeable` |

## Acceptkriterier (2.4)

- [x] A3 kan ikke merges uden godkendelse (`merge-check` + test 2).
- [x] Godkender uden påkrævet træningsmodul afvises (test 2b).
- [x] UI viser diff + evidens adskilt fra prosa (`renderView`).
