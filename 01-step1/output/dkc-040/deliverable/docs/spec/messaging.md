# Holdbar beskedudveksling mellem servere

DKC-040. Kommunikation mellem tjenester skal tåle retries, udfald og at en
worker flytter til en anden server. Specen beskriver den protokol der er
implementeret i `jobs/`, og de grænser der er ærligt markeret som NOT RUN.

## Mål

- En committed forretningsændring har altid en begivenhed, og en rullet tilbage
  ændring har ingen.
- En genleveret begivenhed giver ikke en dobbelt sideeffekt.
- Et nedbrud efter sideeffekt men før ack reconcileres uden blind genudførelse.
- Et mistet lease forhindrer en gammel worker i at fortsætte.
- Kønedbrud giver synlig køtilstand og ingen falsk succes.
- En poison-besked blokerer ikke alle kunder.
- Leveringsgarantien er **at-least-once**; exactly-once påstås ikke.

## Topologien

`jobs/messaging.json` er den kanoniske topologi og valideres af
`contracts/messaging-topology.schema.json` samt beslutningssemantikken i
`jobs/src/topology.mjs`:

- **Broker:** holdbar, mindst tre replikaer i tre fejldomæner, quorum = flertal,
  publisher confirms og consumer-acks, usikre writes ved quorumtab afvist,
  tenantadskilt retention og dead-letter-emne.
- **Outbox:** `event_outbox` skrives transaktionelt sammen med mindst én
  domænetabel og bekræfter via `broker-ack`.
- **Inbox:** `event_inbox` deduplikerer på `(tenant, consumer, event_id)` og
  håndhæver logisk rækkefølge pr. ressource.
- **Singletonjobs:** `singleton_leases` med monotont `fencing_token`.
- **Backpressure:** synlig backlog og alder; udgivere pauses over grænsen.
- **Poison:** `event_dead_letters` isolerer pr. tenant/consumer.

## Protokol

### 1. Transaktionel outbox

```js
db.transaction(() => {
  // forretningsændring
  messaging.outbox.append(tenantId, event, { idempotencyKey });
});
```

`append` skriver begivenheden i **samme** transaktion. Rulles ændringen tilbage,
forsvinder begivenheden også. `idempotencyKey` (som standard event-ID'et) er
unik pr. tenant, så samme logiske begivenhed ikke kan skrives to gange.

### 2. Publisher confirms

```js
await messaging.outbox.publishPending(tenantId, { publisher });
```

`claimBatch` tager en lease med et monotont `lease_token`. `publisher(event)`
kaldes; kun hvis den **bekræfter** (returnerer uden fejl), markeres begivenheden
`confirmed`. En fejlet udgivelse forbliver `pending` med backoff og en synlig
fejl. En gammel udgiver hvis lease er overtaget kan ikke bekræfte, fordi tokenet
ikke længere matcher.

### 3. Inbox: dedup, rækkefølge og ack

```js
await messaging.inbox.deliver(tenantId, {
  consumer,
  event,
  handler: async (event) => { /* sideeffekt */ },
  reconcile: async ({ prior }) => ({ resolved: true, state: "processed" }),
  irreversible: false,
});
```

- Rækken skrives `received` **før** handleren kaldes.
- Ressource-versionen opdateres først ved `ack`; et nedbrud før ack låser derfor
  ikke efterfølgende versioner ude.
- Version ≤ den behandlede afvises som `skipped` (stale).
- Et hul i versionsrækken udsættes (`deferred`), så begivenheder ikke anvendes i
  forkert rækkefølge.
- Et genfundet `processing`-spor uden reconciliation går til dead-letter — en
  irreversibel begivenhed genudføres ikke blindt.

### 4. Singletonjobs

```js
const lease = messaging.singletons.acquire(tenantId, name, { holder, leaseMs });
if (messaging.singletons.isValid(tenantId, name, lease.row)) { /* sideeffekt */ }
```

Hver overtagelse hæver `fencing_token`. Et gammelt token afvises ved både
`heartbeat` og `isValid`.

### 5. Køsundhed og backpressure

`messaging.health.snapshot(tenantId)` læser faktisk backlog og alder. Kan
lageret ikke læses, er svaret `unknown` — aldrig en falsk grøn. Over grænsen
sættes `paused: true`, så udgivere kan pauses.

## Kontrakter

- `contracts/messaging-topology.schema.json` — den kanoniske topologi.
- `contracts/outbox-record.schema.json` — den vedvarende outbox-række.
- CloudEvent-envelopen genbruger `contracts/cloud-event.schema.json`.

## Test og kontrol

| Kommando | Dækker |
| --- | --- |
| `make messaging-check` | Topologi, outbox-/inbox-kontrakt og rækkefølgepolitik |
| `make messaging-test` | Outbox/inbox, publisher confirms, dedup, rækkefølge, leases, backpressure, poison |

En **rigtig** broker med publisher confirms og consumer-acks er
`integration-message-broker` og er NOT RUN i dette miljø; outbox/inbox-protokollen
er efterprøvet mod den rigtige SQLite-persistens, men en faktisk
brokerbekræftelse og målt leverance kræver en levende broker.
