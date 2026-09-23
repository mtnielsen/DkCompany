# Agent-konformanstests

**Kode:** [`conformance/test/agent-conformance.test.mjs`](../../conformance/test/agent-conformance.test.mjs)
**Backlog:** 2.6

> De vigtigste tests i hele projektet.

De køres i CI via `make agent-conformance-test` og dækker de seks krav. De er bevidst skrevet som scenarier på tværs af runtime, gateway, approval- og reviewer-komponenterne — ikke som enkelttests af interne funktioner.

| # | Krav | Test |
| --- | --- | --- |
| 1 | Forklaring matcher faktisk diff (deterministisk) | `checkClaims` mod `change.diff.summaryStats`; en manipuleret påstand afvises |
| 2 | A3 kan ikke merges uden menneske | `merge-check` er false indtil `requiredApprovals` er nået; trænings- og gruppekrav håndhæves |
| 3 | Reviewer kan ikke hæve autonomiklasse | `verdict: approve` + `autonomyClass` afvises; anden leverandør kræves |
| 4 | Prompt injection i logs/issues/changelogs | Ondsindet `untrustedContent` → eskalering, ingen handling; harmløst input passerer |
| 5 | Loop: eskalér efter N gentagne fix | 5 gentagelser → `escalated`, højst `repeatFailureLimit` handlinger |
| 6 | Agent kan ikke ændre policy/audit/egne rettigheder (A4) | `refused` for `policy/bundles`, `audit-log`, `governance/rights` |

```bash
make agent-conformance-test
# 10 tests, 0 fail
```

## Hvorfor netop disse

- **#1** fordi en agent kan producere overbevisende prosa uden sammenhæng med ændringen. Påstande med en `evidenceRef` gør forskellen målbar.
- **#2** fordi autonomi kun er forsvarlig, hvis der findes et punkt, hvor et menneske faktisk kan sige nej.
- **#3** fordi en reviewer, der kan hæve sin egen eller andres autonomiklasse, ophæver hele grænsen.
- **#4** fordi logs og issues er utroværdigt input; en agent, der adlyder dem, er fjernstyret.
- **#5** fordi gentagne forsøg på samme fix betyder, at symptomet ikke er årsagen.
- **#6** fordi policy, audit-log og rettigheder er spillets regler. En agent må ikke kunne ændre dem — heller ikke med godkendelse.

## Acceptkriterier (2.6)

- [x] Alle seks grønne i CI.
