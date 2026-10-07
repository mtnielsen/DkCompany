# Runbook — køhændelse

Formål: håndtere en kø der vokser, en udgiver der ikke kan bekræfte, en
genleveret begivenhed eller en poison-besked uden at skabe dobbelteffekter.

## Forudsætninger

- `jobs/messaging.json` er den gældende topologi; `make messaging-check`
  bekræfter at den er konsistent.
- Køsundheden er observerbar gennem `messaging.health.snapshot(tenantId)`.
- En navngivet incident commander og den aftalte backlog-/aldersgrænse.

## Symptom: stigende backlog eller alder

1. Læs `messaging.health.snapshot(tenantId)`. Er svaret `unknown`, er lageret
   ikke læseligt — behandl det som nedbrud, ikke som grønt.
2. Er `paused: true`, så pause nye udgivere for tenanten (backpressure).
3. Undersøg `event_outbox` for `pending` rækker med `last_error`.
4. Genstart udgivere; `recoverStaleClaims` genåbner leases fra en død udgiver,
   så en anden kan tage over.
5. Bekræft at backloggen falder, før udgivere genoptages.

## Symptom: udgivelse bekræftes ikke

1. En ikke-bekræftet begivenhed forbliver `pending`; der er ingen falsk succes.
2. Undersøg brokkerne og `last_error`. Er forsøgsgrænsen nået, bliver rækken
   `failed` og skal behandles manuelt.
3. Genudgiv kun via outboxen, så `lease_token` og idempotency bevares.

## Symptom: genleveret eller ombyttet begivenhed

1. Inboxen deduplikerer på `(tenant, consumer, event_id)`; en allerede
   behandlet begivenhed giver `replayed` uden ny sideeffekt.
2. En begivenhed med version ≤ den behandlede afvises som `skipped`.
3. Et hul i versionsrækken giver `deferred`; lad begivenheden ligge i køen, indtil
   den mellemliggende version er behandlet. Spring den ikke over.

## Symptom: nedbrud efter sideeffekt før ack

1. Rækken står `processing`. Den må **ikke** genudføres blindt.
2. Kør reconciliation mod den eksterne sandhed. Afklares den som gennemført,
   markeres `processed` uden en ny sideeffekt.
3. Kan sandheden ikke afgøres, flyttes begivenheden til dead-letter for
   menneskelig behandling.

## Symptom: poison-besked

1. Dead-letter-køen er tenantafgrænset (`event_dead_letters`), så kun den
   berørte kundes consumer rammes.
2. Inspicér årsagen, ret payloaden, og brug `redrive` til at genindlæse den for
   en ny runde.

## Bevis

`make messaging-test` efterprøver protokollen mod den rigtige persistens
(outbox/inbox, dedup, rækkefølge, fencing, backpressure og poison). En **rigtig**
broker og en målt leverance er `integration-message-broker` og er NOT RUN i
dette miljø.
