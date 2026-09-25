# ADR-0045 — Holdbar beskedudveksling med transaktionel outbox og tenantbundne begivenheder

- **Status:** accepteret
- **Beslutningstagere:** Platform Owner, Security Owner
- **Dato:** 2026-09-25
- **Beslutningsdrev:** DKC-040. ADR-0024 gav jobs leases, idempotency-keys og dead-letter på én database. Men kommunikation mellem tjenester og genstart af en worker kan stadig tabe eller gentage en sideeffekt, hvis begivenheden ikke skrives sammen med ændringen og ikke dedupliseres hos forbrugeren.

## Kontekst og problemstilling

Når en tjeneste udfører en forretningsmæssig ændring og derefter udgiver en
begivenhed, findes der et vindue hvor ændringen er committet men begivenheden
aldrig bliver sendt — eller hvor begivenheden sendes men ændringen rulles
tilbage. En genlevering kan give en dobbelt sideeffekt, og en forsinket eller
ombyttet begivenhed kan anvende ændringer i forkert rækkefølge.

Det mangler at gøre udvekslingen holdbar:

- en holdbar kø med publisher confirms og consumer-acks,
- en transaktionel outbox og en deduplikerende inbox,
- tenantbundne event-ID'er, versionsfelter og idempotency,
- lease og fencing-token for singletonjobs,
- retry/backoff, dead-letter og backpressure, og
- logisk rækkefølge pr. ressource — uden en generel exactly-once-påstand.

## Beslutningskriterier

- En committed ændring har altid en begivenhed; en rullet tilbage ændring har
  ingen.
- En genleveret begivenhed giver ikke en dobbelt sideeffekt.
- Et nedbrud efter sideeffekt før ack reconcileres uden blind genudførelse.
- Et mistet lease forhindrer en gammel worker i at fortsætte.
- Kønedbrud giver synlig køtilstand og ingen falsk succes.
- En poison-besked blokerer ikke alle kunder.
- Leveringsgarantien er ærligt at-least-once.

## Overvejede muligheder

- **A:** Udgiv begivenheder direkte efter commit uden outbox eller dedup.
- **B:** Brug en in-memory-kø og stol på at processen ikke genstarter.
- **C:** En transaktionel outbox, en deduplikerende inbox med versionsbaseret
  rækkefølge, publisher confirms, fencing og synlig backpressure — ærligt
  dokumenteret som at-least-once.

## Beslutning

Vi indfører (C). `jobs/messaging.json` er den kanoniske topologi,
`contracts/messaging-topology.schema.json` og `contracts/outbox-record.schema.json`
beskriver formen, `jobs/src/topology.mjs` og `conformance/src/messaging.mjs`
håndhæver beslutningerne, og `jobs/src/{outbox,inbox,singleton,health}.mjs`
implementerer protokollen oven på `persistence/migrations/0011_messaging_outbox.sql`.

### Konsekvenser

- **Positive:** Ændring og begivenhed er atomiske; duplikater, forsinkede og
  ombyttede begivenheder håndteres maskinelt; singletonjobs er fenced; køtilstand
  og poison-isolation er synlige.
- **Negative:** Der findes ingen kørende broker i dette miljø. En faktisk
  brokerbekræftelse og målt leverance (`integration-message-broker`) er NOT RUN.
- **Neutrale:** Leveringsgarantien er at-least-once; exactly-once påstås ikke.

## Fordele og ulemper ved mulighederne

| Mulighed | Fordele | Ulemper |
| --- | --- | --- |
| A | Simpel, ingen ekstra tabeller | Taber eller gentager sideeffekter; ingen rækkefølge |
| B | Ingen persistens at vedligeholde | Taber al tilstand ved genstart; ingen dedup |
| C | Atomisk, deduplikeret, fenced og synlig | Kræver outbox/inbox-tabeller og en rigtig broker for fuld effekt |

## Mere information

- [ADR-0024 — Genoptagelige job med leases, idempotency-keys og dead-letter](0024-genoptagelige-og-idempotente-jobs.md)
- [Spec: holdbar beskedudveksling](../spec/messaging.md)
- [Runbook: køhændelse](../runbooks/queue-incident.md)
