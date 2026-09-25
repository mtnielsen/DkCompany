# Adversarial reviewer-agent

**Kode:** [`reviewer/`](../../reviewer)
**Kontrakter:** [`agent-manifest.schema.json`](../../contracts/agent-manifest.schema.json) (`review`-blokken)
**Backlog:** 2.5

## Formål

Reviewer-agenten forbedrer forslag **før** mennesket ser dem. Den er ikke en sikkerhedskontrol, man kan læne sig på. Derfor er dens beføjelser bevidst skåret ind til benet.

## Tre regler

1. **Anden leverandør end forfatteren.** Samme model i en anden prompt giver korrelerede fejl, ikke uafhængighed. `createReviewerAgent` nægter at starte, hvis `providerName === authorProvider`.
2. **Ser ændring + rådata — ikke begrundelsen.** `review({ change, rawData })` har ingen rationale-parameter. Ellers ankrær revieweren på forfatterens fortælling, og uafhængigheden er illusorisk.
3. **Kan kun `no-objection` / `flag` / `reject`.** Aldrig `approve`. Forsøger modellen at sætte en autonomiklasse, afvises det, logges som finding, og feltet fjernes fra svaret. At hæve autonomiklasse er A4.

## Reviewerens leverandør

Revieweren har ikke sin egen leverandøradgang. `gateway/src/reviewer-provider.mjs` forbinder reviewerens `review()`-interface til gatewayens serverstyrede route, så selve modelkaldet går gennem den samme gateway med den samme egress-grænse og det samme budget som alle andre kald. Routen for `dummy-ok-reviewer` peger på en anden leverandør (`openai`) end forfatteren (`anthropic`), og `createReviewerAgent` nægter fortsat at starte hvis `providerName === authorProvider`. Dermed er "reel leverandør" en egenskab ved den serverstyrede route, ikke ved reviewerens prompt.

## Svar

```json
{
  "reviewerRef": "dummy-ok-reviewer",
  "provider": "openai",
  "verdict": "flag",
  "findings": ["rollback testet mod anden version end den foreslåede"],
  "sawAuthorRationale": false
}
```

`sawAuthorRationale` er altid `false`. Verdict logges og indgår i approval-payloadens `reviewerFindings`.

## Hvorfor ikke bare lade den godkende

En reviewer, der kan godkende, bliver et ekstra led, man begynder at stole på — og dermed en kilde til falsk tryghed. Kan den kun flagge eller afvise, forbliver ansvaret et sted: hos mennesket. Effekten måles i 2.7.

## Acceptkriterier (2.5)

- [x] Reviewer kan ikke godkende; kan ikke ændre autonomiklasse (test 3).
- [x] Reviewer er fra en anden leverandør end forfatteren (test 3b).
- [x] `sawAuthorRationale: false`; verdict returneres og kan logges.
- [x] Reviewerens modelkald går gennem gatewayen og bruger en anden leverandør end forfatteren (`reviewer/test/reviewer-provider.test.mjs`).
