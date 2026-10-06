# Reviewer-effektmåling

**Kode:** [`reviewer/src/metrics.mjs`](../../reviewer/src/metrics.mjs)
**Backlog:** 2.7

> Uden dette tal ved du ikke, om review-laget gør gavn eller skaber falsk tryghed.

## To tal

| Metrik | Betydning |
| --- | --- |
| `flaggedButApproved` (friction) | Revieweren fandt noget, men mennesket godkendte alligevel. Friktion — eller en fangst mennesket ellers ville have overset. |
| `greenButBroke` (falsk negativ) | Revieweren gav grønt lys, og ændringen brækkede bagefter. Det farlige tal. |

Afledte rater:

- `frictionRate = flaggedButApproved / flagged`
- `falseNegativeRate = greenButBroke / noObjection`
- `reviewerRejectAgreement` — andel hvor reviewer og menneske var enige om afvisning.

## Sådan måles det

Tre begivenheder pr. forslag, uafhængige af hinanden:

```
POST /v1/reviews    { requestId, verdict: "no-objection"|"flag"|"reject", reviewerRef }
POST /v1/decisions  { requestId, verdict: "approve"|"reject" }
POST /v1/outcomes   { requestId, broke: true|false }
```

`GET /v1/metrics` giver tallene. `GET /` viser dashboardet.

```bash
make reviewer-metrics    # http://127.0.0.1:8484/
make reviewer-test
```

Dashboardet fremhæver `greenButBroke` rødt, når det er større end nul. Et review-lag, der aldrig fanger noget, eller som giver grønt lys til noget der brækker, er værre end ingen reviewer — fordi det skaber falsk tryghed.

## Acceptkriterier (2.7)

- [x] Metrik logges og er synlig i dashboard (`GET /`, `GET /v1/metrics`).
- [x] Både "fanget, men godkendt" og "grønt, men brækkede" måles.
